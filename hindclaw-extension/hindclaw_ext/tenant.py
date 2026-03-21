"""HindclawTenant — Hindsight TenantExtension for JWT/API key authentication.

Authenticates requests by detecting token format (JWT or API key).
Sets request_context.tenant_id as a side-effect for the validator to read.

See spec Section 5. The Hindsight engine calls authenticate() for every
core memory operation (recall/retain/reflect). The same request_context
object is later passed to HindclawValidator.
"""

import contextvars
import logging

from hindsight_api.extensions import AuthenticationError, TenantContext, TenantExtension
from hindsight_api.extensions.tenant import Tenant

from hindsight_api.models import RequestContext

from hindclaw_ext import db
from hindclaw_ext.auth import decode_jwt

logger = logging.getLogger(__name__)

# Contextvar: JWT claims shared with HindclawValidator (per-request, async-safe).
# Only populated for JWT auth — empty dict for API key auth.
_jwt_claims: contextvars.ContextVar[dict] = contextvars.ContextVar("hindclaw_jwt_claims", default={})


class HindclawTenant(TenantExtension):
    """Authenticate requests via JWT (plugins) or API key (CLI/dashboard/MCP).

    Detects token format by the ``eyJ`` prefix (base64-encoded JWT header).
    Sets ``request_context.tenant_id`` as a side-effect — the Hindsight engine
    only reads ``TenantContext.schema_name`` for DB schema routing. JWT claims
    are stored in the ``_jwt_claims`` contextvar for HindclawValidator to read.

    See spec Section 5.
    """

    async def authenticate(self, context: RequestContext) -> TenantContext:
        """Authenticate the request and resolve user identity.

        Detects token format (JWT by ``eyJ`` prefix, otherwise API key).
        Sets ``context.tenant_id`` as a side-effect for the validator.
        Stores JWT claims in ``_jwt_claims`` contextvar for the validator.

        Args:
            context: RequestContext with ``api_key`` from Authorization header.

        Returns:
            TenantContext with schema_name="public" (single-tenant).

        Raises:
            AuthenticationError: If token is missing, expired, invalid, or
                API key not found.
        """
        token = context.api_key
        if not token:
            raise AuthenticationError("Missing Authorization header")

        if token.startswith("eyJ"):
            # JWT path — plugin acting on behalf of a user
            try:
                claims = decode_jwt(token)
            except Exception as e:
                error_msg = str(e)
                if "expired" in error_msg.lower():
                    raise AuthenticationError("Token expired")
                raise AuthenticationError(f"Invalid token: {error_msg}")

            # Store claims in contextvar for validator to read
            _jwt_claims.set(claims)

            # Resolve sender -> user
            sender = claims.get("sender")
            if sender:
                if ":" not in sender:
                    raise AuthenticationError(f"Invalid sender format: {sender!r} (expected 'provider:id')")
                provider, sender_id = sender.split(":", 1)
                user = await db.get_user_by_channel(provider, sender_id)
                context.tenant_id = user.id if user else "_anonymous"
            else:
                context.tenant_id = "_admin"
        else:
            # API key path — direct access (CLI, dashboard, Terraform, MCP)
            key_record = await db.get_api_key(token)
            if not key_record:
                raise AuthenticationError("Invalid API key")
            context.tenant_id = key_record.user_id
            _jwt_claims.set({})  # no claims for API key auth

        return TenantContext(schema_name="public")

    async def list_tenants(self) -> list[Tenant]:
        return [Tenant(schema="public")]
