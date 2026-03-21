"""Shared test fixtures for hindclaw-extension tests."""
from unittest.mock import AsyncMock

import pytest


@pytest.fixture
def mock_pool():
    """Mock asyncpg connection pool."""
    pool = AsyncMock()
    conn = AsyncMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    # Also support pool.fetchrow / pool.fetch directly
    pool.fetch = AsyncMock(return_value=[])
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetchval = AsyncMock(return_value=None)
    pool.execute = AsyncMock()
    return pool


@pytest.fixture
def seed_data():
    """Standard test data matching spec examples."""
    return {
        "users": [
            {"id": "alice", "display_name": "Alice", "email": "alice@example.com"},
            {"id": "bob", "display_name": "Bob", "email": None},
        ],
        "channels": [
            {"user_id": "alice", "provider": "telegram", "sender_id": "100001"},
            {"user_id": "bob", "provider": "telegram", "sender_id": "100002"},
        ],
        "groups": [
            {"id": "_default", "display_name": "Anonymous", "recall": False, "retain": False},
            {
                "id": "team-lead",
                "display_name": "Team Lead",
                "recall": True,
                "retain": True,
                "retain_tags": ["role:team-lead"],
                "recall_budget": "mid",
                "recall_tag_groups": [{"not": {"tags": ["sensitivity:restricted"], "match": "any_strict"}}],
            },
            {
                "id": "engineering",
                "display_name": "Engineering",
                "recall": True,
                "retain": True,
                "retain_tags": ["department:engineering"],
                "recall_budget": "low",
            },
        ],
        "memberships": [
            {"group_id": "team-lead", "user_id": "alice"},
            {"group_id": "engineering", "user_id": "alice"},
            {"group_id": "engineering", "user_id": "bob"},
        ],
        "bank_permissions": [
            {"bank_id": "agent-alpha", "scope_type": "group", "scope_id": "team-lead", "recall": True, "retain": False},
        ],
        "strategy_scopes": [
            {"bank_id": "agent-alpha", "scope_type": "topic", "scope_value": "500001", "strategy": "conversation"},
        ],
    }
