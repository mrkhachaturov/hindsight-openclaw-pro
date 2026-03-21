"""HindclawHttp — Hindsight HttpExtension for managing access control.

REST API at /ext/hindclaw/ for users, groups, permissions, strategies, API keys.
Parses JWT independently — /ext/ routes do NOT pass through TenantExtension.

See spec Section 8.
"""

import json
import logging
import os
import secrets

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from hindsight_api.extensions import AuthenticationError, HttpExtension

from hindclaw_ext import db
from hindclaw_ext import resolver
from hindclaw_ext.auth import decode_jwt
from hindclaw_ext.http_models import (
    AddChannelRequest,
    AddMemberRequest,
    ApiKeyCreateResponse,
    ApiKeyResponse,
    BankPermissionRequest,
    BankPermissionResponse,
    ChannelResponse,
    CreateApiKeyRequest,
    CreateGroupRequest,
    CreateUserRequest,
    GroupMemberResponse,
    GroupMembershipConfirmation,
    GroupResponse,
    GroupSummaryResponse,
    ResolvedPermissionsResponse,
    StrategyRequest,
    StrategyScopeResponse,
    StrategyUpsertConfirmation,
    UpdateGroupRequest,
    UpdateUserRequest,
    UpsertConfirmation,
    UserResponse,
)

logger = logging.getLogger(__name__)

# Permission fields shared with groups and bank_permissions tables.
# Single source of truth — used for SQL column lists, JSONB serialization, and upsert.
_PERMISSION_COLUMNS = (
    "recall", "retain", "retain_roles", "retain_tags", "retain_every_n_turns",
    "recall_budget", "recall_max_tokens", "recall_tag_groups",
    "llm_model", "llm_provider", "exclude_providers", "retain_strategy",
)

# Number of characters to show when masking API keys in list responses.
_API_KEY_MASK_LENGTH = 12

# Subset of _PERMISSION_COLUMNS that are JSONB — derived, not maintained separately.
_JSONB_FIELDS = frozenset(c for c in _PERMISSION_COLUMNS if c.endswith(("_roles", "_tags", "_groups", "_providers")))


def _serialize_jsonb(data: dict) -> dict:
    """Return a copy of data with JSONB fields serialized for asyncpg.

    Args:
        data: Dict from Pydantic model_dump(). Not modified.

    Returns:
        New dict with JSONB fields serialized to JSON strings.
    """
    result = dict(data)
    for field in _JSONB_FIELDS:
        if field in result and result[field] is not None:
            result[field] = json.dumps(result[field])
    return result


def _parse_jsonb_row(row) -> dict:
    """Convert an asyncpg row to a dict with parsed JSONB fields.

    asyncpg returns JSONB columns as strings — Pydantic response models
    expect Python lists/dicts. Only fields in ``_JSONB_FIELDS`` are parsed;
    all others are passed through unchanged.

    Args:
        row: asyncpg Record from any hindclaw table query.

    Returns:
        Dict suitable for response model construction.
    """
    result = dict(row)
    for field in _JSONB_FIELDS:
        if field in result and isinstance(result[field], str):
            result[field] = json.loads(result[field])
    return result


async def _upsert_bank_permission(
    bank_id: str, scope_type: str, scope_id: str, req: BankPermissionRequest
) -> dict:
    """Upsert a bank-level permission entry (group or user scope).

    Args:
        bank_id: Hindsight bank identifier.
        scope_type: "group" or "user".
        scope_id: Group ID or user ID.
        req: Permission fields to set.

    Returns:
        Dict with bank_id, scope_type, scope_id confirming the upsert.
    """
    pool = await db.get_pool()
    data = _serialize_jsonb(req.model_dump())
    cols = ", ".join(_PERMISSION_COLUMNS)
    placeholders = ", ".join(f"${i+4}" for i in range(len(_PERMISSION_COLUMNS)))
    updates = ", ".join(f"{c}=${i+4}" for i, c in enumerate(_PERMISSION_COLUMNS))
    await pool.execute(
        f"""INSERT INTO hindclaw_bank_permissions
            (bank_id, scope_type, scope_id, {cols})
            VALUES ($1, $2, $3, {placeholders})
            ON CONFLICT (bank_id, scope_type, scope_id) DO UPDATE SET
            {updates}, updated_at=NOW()""",
        bank_id, scope_type, scope_id,
        *[data[c] for c in _PERMISSION_COLUMNS],
    )
    return {"bank_id": bank_id, "scope_type": scope_type, "scope_id": scope_id}


def _get_admin_client_ids() -> list[str]:
    """Read admin client IDs from environment.

    Called per-request, not at import time.

    Returns:
        List of allowed client_id values for admin access.
    """
    return [c.strip() for c in os.environ.get("HINDCLAW_ADMIN_CLIENTS", "").split(",") if c.strip()]


_bearer = HTTPBearer()


async def require_admin(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Parse JWT from Bearer token and verify admin client_id.

    /ext/ routes bypass TenantExtension — we parse JWT here directly.
    HTTPBearer extracts the token and returns 403 for missing/malformed
    credentials. AuthenticationError is caught by Hindsight's global
    exception handler (returns 401).

    Args:
        credentials: Bearer token extracted by FastAPI's HTTPBearer scheme.

    Returns:
        Decoded JWT claims dict.

    Raises:
        AuthenticationError: If token is invalid or client_id is not an admin.
    """
    try:
        claims = decode_jwt(credentials.credentials)
    except Exception as e:
        raise AuthenticationError(str(e))
    if claims.get("client_id") not in _get_admin_client_ids():
        raise AuthenticationError("Admin access required")
    return claims


class HindclawHttp(HttpExtension):
    """REST API for managing hindclaw access control data.

    Provides CRUD endpoints at ``/ext/hindclaw/`` for users, groups,
    permissions, strategy scopes, and API keys. All endpoints require
    admin JWT authentication via the ``require_admin`` dependency.

    See spec Section 8.
    """

    def get_router(self, memory) -> APIRouter:
        """Return FastAPI router with all hindclaw management endpoints.

        Args:
            memory: MemoryEngine instance (not used directly — we use our own
                DB pool from ``db.get_pool()`` for consistency).

        Returns:
            APIRouter mounted at ``/ext/hindclaw/`` by the Hindsight server.
        """
        router = APIRouter(prefix="/hindclaw", dependencies=[Depends(require_admin)])

        # --- Users ---

        @router.get("/users", response_model=list[UserResponse], operation_id="list_users")
        async def list_users():
            pool = await db.get_pool()
            rows = await pool.fetch("SELECT id, display_name, email FROM hindclaw_users ORDER BY id")
            return [{"id": r["id"], "display_name": r["display_name"], "email": r["email"]} for r in rows]

        @router.post("/users", status_code=201, response_model=UserResponse, operation_id="create_user")
        async def create_user(req: CreateUserRequest):
            pool = await db.get_pool()
            try:
                await pool.execute(
                    "INSERT INTO hindclaw_users (id, display_name, email) VALUES ($1, $2, $3)",
                    req.id, req.display_name, req.email,
                )
            except asyncpg.UniqueViolationError:
                raise HTTPException(409, f"User {req.id} already exists")
            return {"id": req.id, "display_name": req.display_name, "email": req.email}

        @router.get("/users/{user_id}", response_model=UserResponse, operation_id="get_user")
        async def get_user(user_id: str):
            pool = await db.get_pool()
            row = await pool.fetchrow("SELECT id, display_name, email FROM hindclaw_users WHERE id = $1", user_id)
            if not row:
                raise HTTPException(404, f"User {user_id} not found")
            return {"id": row["id"], "display_name": row["display_name"], "email": row["email"]}

        @router.put("/users/{user_id}", response_model=UserResponse, operation_id="update_user")
        async def update_user(user_id: str, req: UpdateUserRequest):
            pool = await db.get_pool()
            updates = req.model_dump(exclude_none=True)
            if not updates:
                raise HTTPException(400, "No fields to update")
            # Column names come from Pydantic model field names (not user input) — safe
            set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates.keys()))
            set_clause += ", updated_at = NOW()"
            row = await pool.fetchrow(
                f"UPDATE hindclaw_users SET {set_clause} WHERE id = $1 RETURNING id, display_name, email",
                user_id, *updates.values(),
            )
            if not row:
                raise HTTPException(404, f"User {user_id} not found")
            return row

        @router.delete("/users/{user_id}", status_code=204, operation_id="delete_user")
        async def delete_user(user_id: str):
            pool = await db.get_pool()
            existing = await pool.fetchval("SELECT id FROM hindclaw_users WHERE id = $1", user_id)
            if not existing:
                raise HTTPException(404, f"User {user_id} not found")
            # Application-level cascade in transaction (FK handles channels, api_keys, group_members)
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        "DELETE FROM hindclaw_bank_permissions WHERE scope_type = 'user' AND scope_id = $1", user_id
                    )
                    await conn.execute(
                        "DELETE FROM hindclaw_strategy_scopes WHERE scope_type = 'user' AND scope_value = $1", user_id
                    )
                    await conn.execute("DELETE FROM hindclaw_users WHERE id = $1", user_id)

        # --- User Channels ---

        @router.get("/users/{user_id}/channels", response_model=list[ChannelResponse], operation_id="list_user_channels")
        async def list_user_channels(user_id: str):
            pool = await db.get_pool()
            rows = await pool.fetch(
                "SELECT provider, sender_id FROM hindclaw_user_channels WHERE user_id = $1", user_id
            )
            return [{"provider": r["provider"], "sender_id": r["sender_id"]} for r in rows]

        @router.post("/users/{user_id}/channels", status_code=201, response_model=ChannelResponse, operation_id="add_user_channel")
        async def add_user_channel(user_id: str, req: AddChannelRequest):
            pool = await db.get_pool()
            try:
                await pool.execute(
                    "INSERT INTO hindclaw_user_channels (user_id, provider, sender_id) VALUES ($1, $2, $3)",
                    user_id, req.provider, req.sender_id,
                )
            except asyncpg.UniqueViolationError:
                raise HTTPException(409, f"Channel {req.provider}:{req.sender_id} already mapped")
            return {"provider": req.provider, "sender_id": req.sender_id}

        @router.delete("/users/{user_id}/channels/{provider}/{sender_id}", status_code=204, operation_id="remove_user_channel")
        async def remove_user_channel(user_id: str, provider: str, sender_id: str):
            pool = await db.get_pool()
            await pool.execute(
                "DELETE FROM hindclaw_user_channels WHERE user_id = $1 AND provider = $2 AND sender_id = $3",
                user_id, provider, sender_id,
            )

        # --- Groups ---

        @router.get("/groups", response_model=list[GroupSummaryResponse], operation_id="list_groups")
        async def list_groups():
            pool = await db.get_pool()
            rows = await pool.fetch("SELECT id, display_name FROM hindclaw_groups ORDER BY id")
            return [{"id": r["id"], "display_name": r["display_name"]} for r in rows]

        @router.post("/groups", status_code=201, response_model=GroupSummaryResponse, operation_id="create_group")
        async def create_group(req: CreateGroupRequest):
            pool = await db.get_pool()
            data = _serialize_jsonb(req.model_dump())
            cols = ", ".join(_PERMISSION_COLUMNS)
            placeholders = ", ".join(f"${i+3}" for i in range(len(_PERMISSION_COLUMNS)))
            try:
                await pool.execute(
                    f"""INSERT INTO hindclaw_groups (id, display_name, {cols})
                        VALUES ($1, $2, {placeholders})""",
                    data["id"], data["display_name"],
                    *[data[c] for c in _PERMISSION_COLUMNS],
                )
            except asyncpg.UniqueViolationError:
                raise HTTPException(409, f"Group {req.id} already exists")
            return {"id": req.id, "display_name": req.display_name}

        @router.get("/groups/{group_id}", response_model=GroupResponse, operation_id="get_group")
        async def get_group(group_id: str):
            pool = await db.get_pool()
            row = await pool.fetchrow(
                """SELECT id, display_name, recall, retain, retain_roles, retain_tags,
                          retain_every_n_turns, recall_budget, recall_max_tokens,
                          recall_tag_groups, llm_model, llm_provider, exclude_providers,
                          retain_strategy
                   FROM hindclaw_groups WHERE id = $1""",
                group_id,
            )
            if not row:
                raise HTTPException(404, f"Group {group_id} not found")
            return _parse_jsonb_row(row)

        @router.put("/groups/{group_id}", response_model=GroupResponse, operation_id="update_group")
        async def update_group(group_id: str, req: UpdateGroupRequest):
            pool = await db.get_pool()
            updates = req.model_dump(exclude_none=True)
            if not updates:
                raise HTTPException(400, "No fields to update")
            serialized = _serialize_jsonb(updates)
            # Column names come from Pydantic model field names (not user input) — safe
            set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(serialized.keys()))
            set_clause += ", updated_at = NOW()"
            cols = "id, display_name, " + ", ".join(_PERMISSION_COLUMNS)
            row = await pool.fetchrow(
                f"UPDATE hindclaw_groups SET {set_clause} WHERE id = $1 RETURNING {cols}",
                group_id, *serialized.values(),
            )
            if not row:
                raise HTTPException(404, f"Group {group_id} not found")
            return _parse_jsonb_row(row)

        @router.delete("/groups/{group_id}", status_code=204, operation_id="delete_group")
        async def delete_group(group_id: str):
            pool = await db.get_pool()
            existing = await pool.fetchval("SELECT id FROM hindclaw_groups WHERE id = $1", group_id)
            if not existing:
                raise HTTPException(404, f"Group {group_id} not found")
            # Application-level cascade in transaction
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        "DELETE FROM hindclaw_bank_permissions WHERE scope_type = 'group' AND scope_id = $1", group_id
                    )
                    await conn.execute(
                        "DELETE FROM hindclaw_strategy_scopes WHERE scope_type = 'group' AND scope_value = $1", group_id
                    )
                    await conn.execute("DELETE FROM hindclaw_groups WHERE id = $1", group_id)

        # --- Group Members ---

        @router.get("/groups/{group_id}/members", response_model=list[GroupMemberResponse], operation_id="list_group_members")
        async def list_group_members(group_id: str):
            pool = await db.get_pool()
            rows = await pool.fetch(
                "SELECT user_id FROM hindclaw_group_members WHERE group_id = $1 ORDER BY user_id", group_id
            )
            return [{"user_id": r["user_id"]} for r in rows]

        @router.post("/groups/{group_id}/members", status_code=201, response_model=GroupMembershipConfirmation, operation_id="add_group_member")
        async def add_group_member(group_id: str, req: AddMemberRequest):
            pool = await db.get_pool()
            await pool.execute(
                "INSERT INTO hindclaw_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                group_id, req.user_id,
            )
            return {"group_id": group_id, "user_id": req.user_id}

        @router.delete("/groups/{group_id}/members/{user_id}", status_code=204, operation_id="remove_group_member")
        async def remove_group_member(group_id: str, user_id: str):
            pool = await db.get_pool()
            await pool.execute(
                "DELETE FROM hindclaw_group_members WHERE group_id = $1 AND user_id = $2",
                group_id, user_id,
            )

        # --- Bank Permissions ---

        @router.get("/banks/{bank_id}/permissions", response_model=list[BankPermissionResponse], operation_id="list_bank_permissions")
        async def list_bank_permissions(bank_id: str):
            pool = await db.get_pool()
            rows = await pool.fetch(
                """SELECT bank_id, scope_type, scope_id, recall, retain,
                          retain_roles, retain_tags, retain_every_n_turns,
                          recall_budget, recall_max_tokens, recall_tag_groups,
                          llm_model, llm_provider, exclude_providers, retain_strategy
                   FROM hindclaw_bank_permissions
                   WHERE bank_id = $1 ORDER BY scope_type, scope_id""",
                bank_id,
            )
            return [_parse_jsonb_row(r) for r in rows]

        @router.get("/banks/{bank_id}/permissions/{scope_type}/{scope_id}", response_model=BankPermissionResponse, operation_id="get_bank_permission")
        async def get_bank_permission(bank_id: str, scope_type: str, scope_id: str):
            pool = await db.get_pool()
            row = await pool.fetchrow(
                """SELECT bank_id, scope_type, scope_id, recall, retain,
                          retain_roles, retain_tags, retain_every_n_turns,
                          recall_budget, recall_max_tokens, recall_tag_groups,
                          llm_model, llm_provider, exclude_providers, retain_strategy
                   FROM hindclaw_bank_permissions
                   WHERE bank_id=$1 AND scope_type=$2 AND scope_id=$3""",
                bank_id, scope_type, scope_id,
            )
            if not row:
                raise HTTPException(404, "Permission not found")
            return _parse_jsonb_row(row)

        @router.put("/banks/{bank_id}/permissions/groups/{group_id}", response_model=UpsertConfirmation, operation_id="upsert_group_permission")
        async def upsert_group_bank_permission(bank_id: str, group_id: str, req: BankPermissionRequest):
            return await _upsert_bank_permission(bank_id, "group", group_id, req)

        @router.put("/banks/{bank_id}/permissions/users/{user_id}", response_model=UpsertConfirmation, operation_id="upsert_user_permission")
        async def upsert_user_bank_permission(bank_id: str, user_id: str, req: BankPermissionRequest):
            return await _upsert_bank_permission(bank_id, "user", user_id, req)

        @router.delete("/banks/{bank_id}/permissions/{scope_type}/{scope_id}", status_code=204, operation_id="delete_bank_permission")
        async def delete_bank_permission(bank_id: str, scope_type: str, scope_id: str):
            pool = await db.get_pool()
            await pool.execute(
                "DELETE FROM hindclaw_bank_permissions WHERE bank_id=$1 AND scope_type=$2 AND scope_id=$3",
                bank_id, scope_type, scope_id,
            )

        # --- Strategy Scopes ---

        @router.get("/banks/{bank_id}/strategies", response_model=list[StrategyScopeResponse], operation_id="list_strategies")
        async def list_strategies(bank_id: str):
            pool = await db.get_pool()
            rows = await pool.fetch(
                """SELECT bank_id, scope_type, scope_value, strategy
                   FROM hindclaw_strategy_scopes
                   WHERE bank_id = $1 ORDER BY scope_type, scope_value""",
                bank_id,
            )
            return [dict(r) for r in rows]

        @router.put("/banks/{bank_id}/strategies/{scope_type}/{scope_value}", response_model=StrategyUpsertConfirmation, operation_id="upsert_strategy")
        async def upsert_strategy(bank_id: str, scope_type: str, scope_value: str, req: StrategyRequest):
            pool = await db.get_pool()
            await pool.execute(
                """INSERT INTO hindclaw_strategy_scopes (bank_id, scope_type, scope_value, strategy)
                   VALUES ($1, $2, $3, $4)
                   ON CONFLICT (bank_id, scope_type, scope_value) DO UPDATE SET strategy = $4""",
                bank_id, scope_type, scope_value, req.strategy,
            )
            return {"bank_id": bank_id, "scope_type": scope_type, "scope_value": scope_value, "strategy": req.strategy}

        @router.delete("/banks/{bank_id}/strategies/{scope_type}/{scope_value}", status_code=204, operation_id="delete_strategy")
        async def delete_strategy(bank_id: str, scope_type: str, scope_value: str):
            pool = await db.get_pool()
            await pool.execute(
                "DELETE FROM hindclaw_strategy_scopes WHERE bank_id=$1 AND scope_type=$2 AND scope_value=$3",
                bank_id, scope_type, scope_value,
            )

        # --- API Keys ---

        @router.get("/users/{user_id}/api-keys", response_model=list[ApiKeyResponse], operation_id="list_api_keys")
        async def list_api_keys(user_id: str):
            """List API keys for a user. Keys are masked after creation."""
            pool = await db.get_pool()
            rows = await pool.fetch(
                "SELECT id, api_key, description FROM hindclaw_api_keys WHERE user_id = $1 ORDER BY id",
                user_id,
            )
            return [
                {"id": r["id"], "api_key_prefix": r["api_key"][:_API_KEY_MASK_LENGTH] + "...", "description": r["description"]}
                for r in rows
            ]

        @router.post("/users/{user_id}/api-keys", status_code=201, response_model=ApiKeyCreateResponse, operation_id="create_api_key")
        async def create_api_key(user_id: str, req: CreateApiKeyRequest):
            pool = await db.get_pool()
            key_id = secrets.token_hex(8)
            api_key = f"hc_{user_id}_{secrets.token_hex(16)}"
            await pool.execute(
                "INSERT INTO hindclaw_api_keys (id, api_key, user_id, description) VALUES ($1, $2, $3, $4)",
                key_id, api_key, user_id, req.description,
            )
            return {"id": key_id, "api_key": api_key, "description": req.description}

        @router.delete("/users/{user_id}/api-keys/{key_id}", status_code=204, operation_id="delete_api_key")
        async def delete_api_key(user_id: str, key_id: str):
            pool = await db.get_pool()
            await pool.execute(
                "DELETE FROM hindclaw_api_keys WHERE id = $1 AND user_id = $2",
                key_id, user_id,
            )

        # --- Debug ---

        @router.get("/debug/resolve", response_model=ResolvedPermissionsResponse, operation_id="debug_resolve")
        async def debug_resolve(
            bank: str = Query(...),
            sender: str | None = Query(None),
            agent: str | None = Query(None),
            channel: str | None = Query(None),
            topic: str | None = Query(None),
        ):
            """Resolve and return full permissions for a given context."""
            user_id = "_anonymous"
            if sender:
                if ":" not in sender:
                    raise HTTPException(400, f"Invalid sender format: {sender!r} (expected 'provider:id')")
                provider, sender_id = sender.split(":", 1)
                user = await db.get_user_by_channel(provider, sender_id)
                user_id = user.id if user else "_anonymous"

            perms = await resolver.resolve(
                user_id=user_id,
                bank_id=bank,
                agent=agent,
                channel=channel,
                topic=topic,
            )
            return perms.model_dump()

        return router
