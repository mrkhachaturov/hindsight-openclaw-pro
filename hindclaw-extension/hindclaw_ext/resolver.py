"""Permission resolver — 4-step algorithm + strategy cascade.

Implements spec Section 7. Reference: build/hindsight-openclaw-pro/src/permissions/resolver.ts
for the same algorithm in TypeScript (client-side, to be replaced by this server-side version).
"""

from hindclaw_ext import db
from hindclaw_ext.models import (
    BankPermissionRecord,
    GroupRecord,
    MergedPermissions,
    ResolvedPermissions,
)

# Budget ordering for "most permissive" merge
_BUDGET_ORDER = {"low": 0, "mid": 1, "high": 2}

# Permission fields shared between GroupRecord, BankPermissionRecord, and MergedPermissions.
# Note: retain_strategy is intentionally excluded — strategy comes from the 5-level
# cascade (db.resolve_strategy), not from the permission merge. The field exists on
# GroupRecord/BankPermissionRecord because it maps to a DB column, but the resolver
# ignores it during merge. See spec Section 7: "retain_strategy: From strategy cascade."
_PERMISSION_FIELDS = (
    "recall", "retain", "retain_roles", "retain_tags", "retain_every_n_turns",
    "recall_budget", "recall_max_tokens", "recall_tag_groups",
    "llm_model", "llm_provider", "exclude_providers",
)


async def resolve(
    user_id: str,
    bank_id: str,
    agent: str | None = None,
    channel: str | None = None,
    topic: str | None = None,
) -> ResolvedPermissions:
    """Resolve permissions for a user on a bank.

    Implements the 4-step algorithm from spec Section 7:
        1. Merge global groups -> effective global profile
        2. Bank _default baseline
        3. Bank group overlay
        4. Bank user override

    Strategy is resolved separately via the 5-level cascade.

    Args:
        user_id: Canonical user ID, or "_anonymous" for unknown senders.
        bank_id: Hindsight bank ID (agent name).
        agent: Agent name from JWT claims (for strategy cascade).
        channel: Channel name from JWT claims (for strategy cascade).
        topic: Topic ID from JWT claims (for strategy cascade).

    Returns:
        ResolvedPermissions with all fields populated (defaults applied).
    """
    is_anonymous = user_id == "_anonymous"

    # Get user's groups (empty for anonymous)
    if is_anonymous:
        groups = []
    else:
        groups = await db.get_user_groups(user_id)

    # If user has no groups, use _default
    if not groups:
        default_group = await db.get_default_group()
        if default_group:
            groups = [default_group]

    # Step 1: Merge global groups
    merged = _merge_groups(groups)

    # Get bank-level permissions
    group_ids = [g.id for g in groups]
    bank_perms = await db.get_bank_permissions(bank_id, group_ids, user_id)

    if bank_perms:
        # Step 2: Bank _default baseline
        default_entry = next((p for p in bank_perms if p.scope_type == "group" and p.scope_id == "_default"), None)
        if default_entry:
            merged = _overlay(merged, default_entry)

        # Step 3: Bank group overlay
        group_entries = [p for p in bank_perms if p.scope_type == "group" and p.scope_id != "_default"]
        if group_entries:
            group_merged = _merge_bank_perms(group_entries)
            merged = _overlay(merged, group_merged)

        # Step 4: Bank user override
        user_entry = next((p for p in bank_perms if p.scope_type == "user" and p.scope_id == user_id), None)
        if user_entry:
            merged = _overlay(merged, user_entry)

    # Resolve strategy separately (5-level cascade)
    strategy = await db.resolve_strategy(
        bank_id=bank_id,
        agent=agent,
        channel=channel,
        topic=topic,
        group_ids=group_ids if group_ids else None,
        user_id=user_id if not is_anonymous else None,
    )

    # Build final result — apply defaults for any fields still None
    retain_tags = list(merged.retain_tags or [])
    if not is_anonymous:
        retain_tags.append(f"user:{user_id}")

    return ResolvedPermissions(
        user_id=user_id,
        is_anonymous=is_anonymous,
        recall=merged.recall or False,
        retain=merged.retain or False,
        retain_roles=merged.retain_roles or ["user", "assistant"],
        retain_tags=retain_tags,
        retain_every_n_turns=merged.retain_every_n_turns or 1,
        retain_strategy=strategy,
        recall_budget=merged.recall_budget or "mid",
        recall_max_tokens=merged.recall_max_tokens or 1024,
        recall_tag_groups=merged.recall_tag_groups,
        llm_model=merged.llm_model,
        llm_provider=merged.llm_provider,
        exclude_providers=merged.exclude_providers or [],
    )


def _merge_groups(groups: list[GroupRecord]) -> MergedPermissions:
    """Merge multiple groups using spec Section 7 merge rules.

    Args:
        groups: Groups sorted alphabetically by ID (for deterministic "first wins" on llm_model).

    Returns:
        MergedPermissions with all applicable fields merged.
    """
    result = MergedPermissions()

    for group in sorted(groups, key=lambda g: g.id):
        # Boolean: most permissive (true > false)
        if group.recall is not None:
            result.recall = (result.recall or False) or group.recall
        if group.retain is not None:
            result.retain = (result.retain or False) or group.retain

        # Lists: unioned
        if group.retain_roles is not None:
            existing = set(result.retain_roles or [])
            result.retain_roles = sorted(existing | set(group.retain_roles))
        if group.retain_tags is not None:
            existing = set(result.retain_tags or [])
            result.retain_tags = sorted(existing | set(group.retain_tags))
        if group.exclude_providers is not None:
            existing = set(result.exclude_providers or [])
            result.exclude_providers = sorted(existing | set(group.exclude_providers))

        # Budget: most permissive (set first value unconditionally, then compare)
        if group.recall_budget is not None:
            if result.recall_budget is None:
                result.recall_budget = group.recall_budget
            elif _BUDGET_ORDER.get(group.recall_budget, 0) > _BUDGET_ORDER.get(result.recall_budget, 0):
                result.recall_budget = group.recall_budget

        # Max tokens: highest value
        if group.recall_max_tokens is not None:
            result.recall_max_tokens = max(result.recall_max_tokens or 0, group.recall_max_tokens)

        # Tag groups: AND-ed (collect all)
        if group.recall_tag_groups is not None:
            existing = result.recall_tag_groups or []
            result.recall_tag_groups = existing + group.recall_tag_groups

        # Every N turns: lowest value (most frequent)
        if group.retain_every_n_turns is not None:
            if result.retain_every_n_turns is None or group.retain_every_n_turns < result.retain_every_n_turns:
                result.retain_every_n_turns = group.retain_every_n_turns

        # LLM model/provider: first group alphabetically that defines it
        if group.llm_model is not None and result.llm_model is None:
            result.llm_model = group.llm_model
        if group.llm_provider is not None and result.llm_provider is None:
            result.llm_provider = group.llm_provider

    return result


def _overlay(base: MergedPermissions, entry: BankPermissionRecord | MergedPermissions) -> MergedPermissions:
    """Overlay a bank-level permission entry onto a base.

    Only non-None fields from the entry override the base.

    Args:
        base: Current accumulated permissions.
        entry: Bank-level override (from DB or from _merge_bank_perms).

    Returns:
        New MergedPermissions with overrides applied.
    """
    result = base.model_copy()

    for field in _PERMISSION_FIELDS:
        value = getattr(entry, field, None)
        if value is not None:
            setattr(result, field, value)

    return result


def _merge_bank_perms(entries: list[BankPermissionRecord]) -> MergedPermissions:
    """Merge multiple bank-level permission entries using same rules as groups.

    Args:
        entries: Bank-level permission entries for this user's groups.

    Returns:
        MergedPermissions with group merge rules applied.
    """
    groups = [
        GroupRecord(
            id=entry.scope_id,
            display_name=entry.scope_id,
            **{f: getattr(entry, f) for f in _PERMISSION_FIELDS},
        )
        for entry in entries
    ]
    return _merge_groups(groups)
