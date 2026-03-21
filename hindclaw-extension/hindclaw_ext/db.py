"""Hindclaw database layer — connection pool, DDL, and queries.

Connection pool is lazily initialized on first use via get_pool().
Reads HINDSIGHT_API_DATABASE_URL from os.environ directly (not from extension config).
DDL is executed on first pool creation via CREATE TABLE IF NOT EXISTS.

See spec Section 3 (Shared State) and Section 4 (Database Schema).
"""

import asyncio
import json
import logging
import os

import asyncpg

from hindclaw_ext.models import (
    ApiKeyRecord,
    BankPermissionRecord,
    GroupRecord,
    UserRecord,
)

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()

# DDL for hindclaw tables — executed on first get_pool() call
_DDL = """\
CREATE TABLE IF NOT EXISTS hindclaw_users (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email        TEXT UNIQUE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hindclaw_api_keys (
    id          TEXT PRIMARY KEY,
    api_key     TEXT UNIQUE NOT NULL,
    user_id     TEXT NOT NULL REFERENCES hindclaw_users(id) ON DELETE CASCADE,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hindclaw_user_channels (
    user_id    TEXT NOT NULL REFERENCES hindclaw_users(id) ON DELETE CASCADE,
    provider   TEXT NOT NULL,
    sender_id  TEXT NOT NULL,
    PRIMARY KEY (provider, sender_id)
);

CREATE TABLE IF NOT EXISTS hindclaw_groups (
    id              TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    recall          BOOLEAN,
    retain          BOOLEAN,
    retain_roles    JSONB,
    retain_tags     JSONB,
    retain_every_n_turns INTEGER,
    recall_budget   TEXT CHECK (recall_budget IN ('low', 'mid', 'high')),
    recall_max_tokens INTEGER,
    recall_tag_groups JSONB,
    llm_model       TEXT,
    llm_provider    TEXT,
    exclude_providers JSONB,
    retain_strategy TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hindclaw_group_members (
    group_id TEXT NOT NULL REFERENCES hindclaw_groups(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES hindclaw_users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS hindclaw_bank_permissions (
    bank_id         TEXT NOT NULL,
    scope_type      TEXT NOT NULL CHECK (scope_type IN ('group', 'user')),
    scope_id        TEXT NOT NULL,
    recall          BOOLEAN,
    retain          BOOLEAN,
    retain_roles    JSONB,
    retain_tags     JSONB,
    retain_every_n_turns INTEGER,
    recall_budget   TEXT CHECK (recall_budget IN ('low', 'mid', 'high')),
    recall_max_tokens INTEGER,
    recall_tag_groups JSONB,
    llm_model       TEXT,
    llm_provider    TEXT,
    exclude_providers JSONB,
    retain_strategy TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (bank_id, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS hindclaw_strategy_scopes (
    bank_id     TEXT NOT NULL,
    scope_type  TEXT NOT NULL CHECK (scope_type IN ('agent', 'channel', 'topic', 'group', 'user')),
    scope_value TEXT NOT NULL,
    strategy    TEXT NOT NULL,
    UNIQUE (bank_id, scope_type, scope_value)
);

INSERT INTO hindclaw_groups (id, display_name, recall, retain)
VALUES ('_default', 'Anonymous', false, false)
ON CONFLICT DO NOTHING;
"""


async def get_pool() -> asyncpg.Pool:
    """Get or create the shared asyncpg connection pool.

    Lazily initializes the pool on first call. Runs DDL to ensure hindclaw
    tables exist. Thread-safe via asyncio.Lock.

    Returns:
        The shared asyncpg connection pool.

    Raises:
        RuntimeError: If HINDSIGHT_API_DATABASE_URL is not set.
    """
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is not None:
            return _pool
        url = os.environ.get("HINDSIGHT_API_DATABASE_URL")
        if not url:
            raise RuntimeError("HINDSIGHT_API_DATABASE_URL environment variable is not set")
        _pool = await asyncpg.create_pool(url, min_size=2, max_size=10)
        # Run DDL in a transaction — all-or-nothing table creation
        async with _pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(_DDL)
        logger.info("Hindclaw DB pool initialized, tables ensured")
        return _pool


def _parse_json(val) -> list | dict | None:
    """Parse JSONB value from asyncpg row.

    asyncpg may return JSONB columns as strings depending on driver version.

    Args:
        val: Raw value from asyncpg — may be None, str, list, or dict.

    Returns:
        Parsed Python object, or None if input is None.
    """
    if val is None:
        return None
    if isinstance(val, (list, dict)):
        return val
    return json.loads(val)


# --- Query functions ---


async def get_user_by_channel(provider: str, sender_id: str) -> UserRecord | None:
    """Resolve a channel sender ID to a user.

    Args:
        provider: Channel provider name (e.g., "telegram", "slack").
        sender_id: Provider-specific sender identifier.

    Returns:
        UserRecord if found, None if the sender is not mapped to any user.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT u.id, u.display_name, u.email
        FROM hindclaw_users u
        JOIN hindclaw_user_channels c ON c.user_id = u.id
        WHERE c.provider = $1 AND c.sender_id = $2
        """,
        provider,
        sender_id,
    )
    if row is None:
        return None
    return UserRecord(id=row["id"], display_name=row["display_name"], email=row["email"])


async def get_api_key(api_key: str) -> ApiKeyRecord | None:
    """Look up an API key by its value.

    Args:
        api_key: The full API key string (e.g., "hc_alice_xxxxxxxxxxxx").

    Returns:
        ApiKeyRecord if found, None if the key does not exist.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, api_key, user_id, description FROM hindclaw_api_keys WHERE api_key = $1",
        api_key,
    )
    if row is None:
        return None
    return ApiKeyRecord(id=row["id"], api_key=row["api_key"], user_id=row["user_id"], description=row["description"])


async def get_user_groups(user_id: str) -> list[GroupRecord]:
    """Get all groups a user belongs to, ordered alphabetically.

    Args:
        user_id: Canonical user identifier.

    Returns:
        List of GroupRecord for each group the user is a member of.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT g.id, g.display_name, g.recall, g.retain,
               g.retain_roles, g.retain_tags, g.retain_every_n_turns,
               g.recall_budget, g.recall_max_tokens, g.recall_tag_groups,
               g.llm_model, g.llm_provider, g.exclude_providers, g.retain_strategy
        FROM hindclaw_groups g
        JOIN hindclaw_group_members m ON m.group_id = g.id
        WHERE m.user_id = $1
        ORDER BY g.id
        """,
        user_id,
    )
    return [
        GroupRecord(
            id=r["id"],
            display_name=r["display_name"],
            recall=r["recall"],
            retain=r["retain"],
            retain_roles=_parse_json(r["retain_roles"]),
            retain_tags=_parse_json(r["retain_tags"]),
            retain_every_n_turns=r["retain_every_n_turns"],
            recall_budget=r["recall_budget"],
            recall_max_tokens=r["recall_max_tokens"],
            recall_tag_groups=_parse_json(r["recall_tag_groups"]),
            llm_model=r["llm_model"],
            llm_provider=r["llm_provider"],
            exclude_providers=_parse_json(r["exclude_providers"]),
            retain_strategy=r["retain_strategy"],
        )
        for r in rows
    ]


async def get_default_group() -> GroupRecord | None:
    """Get the _default group used for anonymous/ungrouped users.

    Returns:
        GroupRecord for the _default group, or None if it doesn't exist.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT id, display_name, recall, retain,
               retain_roles, retain_tags, retain_every_n_turns,
               recall_budget, recall_max_tokens, recall_tag_groups,
               llm_model, llm_provider, exclude_providers, retain_strategy
        FROM hindclaw_groups WHERE id = '_default'
        """
    )
    if row is None:
        return None
    return GroupRecord(
        id=row["id"],
        display_name=row["display_name"],
        recall=row["recall"],
        retain=row["retain"],
        retain_roles=_parse_json(row["retain_roles"]),
        retain_tags=_parse_json(row["retain_tags"]),
        retain_every_n_turns=row["retain_every_n_turns"],
        recall_budget=row["recall_budget"],
        recall_max_tokens=row["recall_max_tokens"],
        recall_tag_groups=_parse_json(row["recall_tag_groups"]),
        llm_model=row["llm_model"],
        llm_provider=row["llm_provider"],
        exclude_providers=_parse_json(row["exclude_providers"]),
        retain_strategy=row["retain_strategy"],
    )


async def get_bank_permissions(
    bank_id: str, group_ids: list[str], user_id: str
) -> list[BankPermissionRecord]:
    """Get all bank-level permission entries for a user's groups and the user itself.

    Automatically includes the _default group in the query.

    Args:
        bank_id: Hindsight bank identifier.
        group_ids: List of group IDs the user belongs to.
        user_id: Canonical user identifier.

    Returns:
        List of BankPermissionRecord ordered by scope_type, scope_id.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT bank_id, scope_type, scope_id,
               recall, retain, retain_roles, retain_tags,
               retain_every_n_turns, recall_budget, recall_max_tokens,
               recall_tag_groups, llm_model, llm_provider,
               exclude_providers, retain_strategy
        FROM hindclaw_bank_permissions
        WHERE bank_id = $1
          AND (
            (scope_type = 'group' AND scope_id = ANY($2))
            OR (scope_type = 'user' AND scope_id = $3)
          )
        ORDER BY scope_type, scope_id
        """,
        bank_id,
        group_ids + ["_default"],
        user_id,
    )
    return [
        BankPermissionRecord(
            bank_id=r["bank_id"],
            scope_type=r["scope_type"],
            scope_id=r["scope_id"],
            recall=r["recall"],
            retain=r["retain"],
            retain_roles=_parse_json(r["retain_roles"]),
            retain_tags=_parse_json(r["retain_tags"]),
            retain_every_n_turns=r["retain_every_n_turns"],
            recall_budget=r["recall_budget"],
            recall_max_tokens=r["recall_max_tokens"],
            recall_tag_groups=_parse_json(r["recall_tag_groups"]),
            llm_model=r["llm_model"],
            llm_provider=r["llm_provider"],
            exclude_providers=_parse_json(r["exclude_providers"]),
            retain_strategy=r["retain_strategy"],
        )
        for r in rows
    ]


async def resolve_strategy(
    bank_id: str,
    agent: str | None = None,
    channel: str | None = None,
    topic: str | None = None,
    group_ids: list[str] | None = None,
    user_id: str | None = None,
) -> str | None:
    """Resolve the retain strategy via the 5-level scope cascade.

    Most specific scope wins. Tiebreaker within same scope_type:
    alphabetically first scope_value. See spec Section 7.

    Cascade priority: user(5) > group(4) > topic(3) > channel(2) > agent(1).

    Args:
        bank_id: Hindsight bank identifier.
        agent: Agent name from JWT claims.
        channel: Channel name from JWT claims.
        topic: Topic ID from JWT claims.
        group_ids: User's group IDs (for group-level strategy scopes).
        user_id: Canonical user identifier (for user-level strategy scopes).

    Returns:
        Named strategy string, or None if no strategy scope matches.
    """
    pool = await get_pool()

    # Build WHERE conditions dynamically
    conditions = []
    params: list = [bank_id]
    idx = 2

    if agent:
        conditions.append(f"(scope_type = 'agent' AND scope_value = ${idx})")
        params.append(agent)
        idx += 1
    if channel:
        conditions.append(f"(scope_type = 'channel' AND scope_value = ${idx})")
        params.append(channel)
        idx += 1
    if topic:
        conditions.append(f"(scope_type = 'topic' AND scope_value = ${idx})")
        params.append(topic)
        idx += 1
    if group_ids:
        conditions.append(f"(scope_type = 'group' AND scope_value = ANY(${idx}))")
        params.append(group_ids)
        idx += 1
    if user_id:
        conditions.append(f"(scope_type = 'user' AND scope_value = ${idx})")
        params.append(user_id)
        idx += 1

    if not conditions:
        return None

    where = " OR ".join(conditions)
    return await pool.fetchval(
        f"""
        SELECT strategy FROM hindclaw_strategy_scopes
        WHERE bank_id = $1 AND ({where})
        ORDER BY
            CASE scope_type
                WHEN 'user'    THEN 5
                WHEN 'group'   THEN 4
                WHEN 'topic'   THEN 3
                WHEN 'channel' THEN 2
                WHEN 'agent'   THEN 1
            END DESC,
            scope_value ASC
        LIMIT 1
        """,
        *params,
    )
