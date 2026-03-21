"""Tests for hindclaw_ext.db — connection pool and queries."""
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.helpers import MockRecord, make_records


@pytest.fixture(autouse=True)
def _reset_pool():
    """Ensure db._pool is reset before and after each test."""
    from hindclaw_ext import db
    original = db._pool
    db._pool = None
    yield
    db._pool = original


@pytest.fixture(autouse=True)
def _set_db_url(monkeypatch):
    """Ensure HINDSIGHT_API_DATABASE_URL is set for pool init tests."""
    monkeypatch.setenv("HINDSIGHT_API_DATABASE_URL", "postgresql://test:test@localhost/test")


@pytest.mark.asyncio
async def test_get_pool_lazy_init():
    """Pool is created lazily on first call."""
    from hindclaw_ext import db

    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    @asynccontextmanager
    async def fake_acquire():
        yield mock_conn

    mock_pool = AsyncMock()
    mock_pool.acquire = fake_acquire

    with patch("asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool) as create:
        pool = await db.get_pool()
        assert pool is mock_pool
        create.assert_called_once()

        # Second call reuses the pool
        pool2 = await db.get_pool()
        assert pool2 is mock_pool
        create.assert_called_once()  # still just once


@pytest.mark.asyncio
async def test_get_user_by_channel(mock_pool):
    """Resolve sender ID to user."""
    from hindclaw_ext import db

    mock_pool.fetchrow.return_value = MockRecord({"id": "alice", "display_name": "Alice", "email": "alice@example.com"})

    with patch.object(db, "_pool", mock_pool):
        user = await db.get_user_by_channel("telegram", "100001")
        assert user is not None
        assert user.id == "alice"

    mock_pool.fetchrow.assert_called_once()


@pytest.mark.asyncio
async def test_get_user_by_channel_not_found(mock_pool):
    """Unknown sender returns None."""
    from hindclaw_ext import db

    mock_pool.fetchrow.return_value = None

    with patch.object(db, "_pool", mock_pool):
        user = await db.get_user_by_channel("telegram", "999999")
        assert user is None


@pytest.mark.asyncio
async def test_get_api_key(mock_pool):
    """Look up API key."""
    from hindclaw_ext import db

    mock_pool.fetchrow.return_value = MockRecord({"id": "key1", "api_key": "hc_alice_xxx", "user_id": "alice", "description": "test"})

    with patch.object(db, "_pool", mock_pool):
        key = await db.get_api_key("hc_alice_xxx")
        assert key is not None
        assert key.user_id == "alice"


@pytest.mark.asyncio
async def test_get_user_groups(mock_pool):
    """Get groups for a user."""
    from hindclaw_ext import db

    mock_pool.fetch.return_value = make_records([
        {"id": "team-lead", "display_name": "Team Lead", "recall": True, "retain": True,
         "retain_roles": None, "retain_tags": json.dumps(["role:team-lead"]),
         "retain_every_n_turns": None, "recall_budget": "mid", "recall_max_tokens": None,
         "recall_tag_groups": None, "llm_model": None, "llm_provider": None,
         "exclude_providers": None, "retain_strategy": None},
    ])

    with patch.object(db, "_pool", mock_pool):
        groups = await db.get_user_groups("alice")
        assert len(groups) == 1
        assert groups[0].id == "team-lead"


@pytest.mark.asyncio
async def test_get_bank_permissions(mock_pool):
    """Get bank-level permissions."""
    from hindclaw_ext import db

    mock_pool.fetch.return_value = make_records([
        {"bank_id": "agent-alpha", "scope_type": "group", "scope_id": "team-lead",
         "recall": True, "retain": False,
         "retain_roles": None, "retain_tags": None, "retain_every_n_turns": None,
         "recall_budget": None, "recall_max_tokens": None, "recall_tag_groups": None,
         "llm_model": None, "llm_provider": None, "exclude_providers": None,
         "retain_strategy": None},
    ])

    with patch.object(db, "_pool", mock_pool):
        perms = await db.get_bank_permissions("agent-alpha", ["team-lead"], "alice")
        assert len(perms) == 1
        assert perms[0].scope_id == "team-lead"
        assert perms[0].recall is True
        assert perms[0].retain is False


@pytest.mark.asyncio
async def test_resolve_strategy(mock_pool):
    """Strategy cascade returns most specific scope."""
    from hindclaw_ext import db

    mock_pool.fetchval.return_value = "conversation"

    with patch.object(db, "_pool", mock_pool):
        strategy = await db.resolve_strategy(
            bank_id="agent-alpha",
            agent="agent-alpha",
            channel="telegram",
            topic="500001",
            group_ids=["team-lead"],
            user_id="alice",
        )
        assert strategy == "conversation"
