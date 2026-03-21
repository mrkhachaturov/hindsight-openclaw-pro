"""HindclawValidator — Hindsight OperationValidatorExtension for access control.

Reads request_context.tenant_id (set by HindclawTenant) and JWT claims
(from contextvar) to resolve permissions and enrich operations.

See spec Section 6. The engine calls validate_*() after authenticate() —
same request_context object, so tenant_id is already set.

Note: on_startup() is NEVER called for OperationValidatorExtension by the
Hindsight server. Do not rely on it for initialization.
"""

import logging

from pydantic import TypeAdapter

from hindsight_api.engine.search.tags import TagGroup
from hindsight_api.extensions import (
    OperationValidatorExtension,
    RecallContext,
    ReflectContext,
    RetainContext,
    ValidationResult,
)

from hindclaw_ext import resolver
from hindclaw_ext.tenant import _jwt_claims

# Adapter to parse raw dicts (from DB) into TagGroup Pydantic models.
# The engine's build_tag_groups_where_clause() expects TagGroup instances,
# not raw dicts — passing dicts causes AttributeError on .tags / .match.
_tag_group_adapter = TypeAdapter(list[TagGroup])

logger = logging.getLogger(__name__)


class HindclawValidator(OperationValidatorExtension):
    """Enforce access control on recall/retain/reflect operations.

    Reads ``request_context.tenant_id`` (set by HindclawTenant) and JWT claims
    (from ``_jwt_claims`` contextvar) to resolve permissions via the 4-step
    algorithm. Enriches accepted operations with tag_groups (recall) or
    tags + strategy (retain) via ``accept_with()``.

    Note: ``on_startup()`` is NEVER called for OperationValidatorExtension
    by the Hindsight server. Do not rely on it for initialization.

    See spec Section 6.
    """

    async def validate_recall(self, ctx: RecallContext) -> ValidationResult:
        """Validate a recall operation before execution.

        Resolves permissions for the user on the target bank. If allowed,
        enriches the request with tag_groups for recall filtering.

        Args:
            ctx: RecallContext with bank_id and request_context.tenant_id.

        Returns:
            ValidationResult — accept (with optional tag_groups) or reject.
        """
        user_id = ctx.request_context.tenant_id
        claims = _jwt_claims.get({})

        perms = await resolver.resolve(
            user_id=user_id,
            bank_id=ctx.bank_id,
            agent=claims.get("agent"),
            channel=claims.get("channel"),
            topic=claims.get("topic"),
        )

        if not perms.recall:
            return ValidationResult.reject(f"recall denied for {user_id} on {ctx.bank_id}")

        if perms.recall_tag_groups is not None:
            # Parse raw dicts into TagGroup Pydantic models — the engine's
            # build_tag_groups_where_clause() expects typed objects, not dicts.
            tag_groups = _tag_group_adapter.validate_python(perms.recall_tag_groups)
            return ValidationResult.accept_with(tag_groups=tag_groups)

        return ValidationResult.accept()

    async def validate_retain(self, ctx: RetainContext) -> ValidationResult:
        """Validate a retain operation before execution.

        Resolves permissions for the user on the target bank. If allowed,
        enriches content items with permission-based tags and strategy.

        Args:
            ctx: RetainContext with bank_id, contents, and request_context.tenant_id.

        Returns:
            ValidationResult — accept_with(contents=enriched) or reject.
        """
        user_id = ctx.request_context.tenant_id
        claims = _jwt_claims.get({})

        perms = await resolver.resolve(
            user_id=user_id,
            bank_id=ctx.bank_id,
            agent=claims.get("agent"),
            channel=claims.get("channel"),
            topic=claims.get("topic"),
        )

        if not perms.retain:
            return ValidationResult.reject(f"retain denied for {user_id} on {ctx.bank_id}")

        # Enrich contents with tags and strategy
        enriched = []
        for item in ctx.contents:
            enriched_item = dict(item)
            existing_tags = enriched_item.get("tags") or []
            enriched_item["tags"] = existing_tags + perms.retain_tags
            if perms.retain_strategy:
                enriched_item["strategy"] = perms.retain_strategy
            enriched.append(enriched_item)

        return ValidationResult.accept_with(contents=enriched)

    async def validate_reflect(self, ctx: ReflectContext) -> ValidationResult:
        """Validate a reflect operation before execution.

        Reflect access follows recall permissions — if the user can recall
        from a bank, they can also reflect on it.

        Args:
            ctx: ReflectContext with bank_id and request_context.tenant_id.

        Returns:
            ValidationResult — accept or reject.
        """
        user_id = ctx.request_context.tenant_id
        perms = await resolver.resolve(user_id=user_id, bank_id=ctx.bank_id)

        if not perms.recall:
            return ValidationResult.reject(f"reflect denied for {user_id} on {ctx.bank_id}")

        return ValidationResult.accept()
