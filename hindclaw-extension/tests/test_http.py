"""Tests for hindclaw_ext.http — HindclawHttp extension."""
import time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import jwt as pyjwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hindsight_api.extensions import AuthenticationError
from hindclaw_ext.http import HindclawHttp

TEST_SECRET = "test-secret-key-for-http-tests!!"


@pytest.fixture(autouse=True)
def _set_env(monkeypatch):
    """Ensure tests use test env vars, not any real values on this host."""
    monkeypatch.setenv("HINDCLAW_JWT_SECRET", TEST_SECRET)
    monkeypatch.setenv("HINDCLAW_ADMIN_CLIENTS", "app-prod,terraform-ci")


def _make_admin_jwt(client_id: str = "app-prod") -> str:
    """Create a signed admin JWT for test requests."""
    return pyjwt.encode(
        {"client_id": client_id, "exp": int(time.time()) + 300},
        TEST_SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def app():
    """Create test app with HindclawHttp router."""
    app = FastAPI()

    @app.exception_handler(AuthenticationError)
    async def auth_error_handler(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={"detail": str(exc)})

    ext = HindclawHttp({})
    memory = AsyncMock()
    router = ext.get_router(memory)
    app.include_router(router, prefix="/ext")
    return app


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def admin_headers():
    return {"Authorization": f"Bearer {_make_admin_jwt()}"}


@pytest.fixture
def mock_db_pool():
    """Patch hindclaw_ext.http.db and yield (mock_db, pool).

    Provides a mock pool with all common methods (execute, fetch, fetchrow,
    fetchval). Tests configure return values on the yielded pool.
    """
    with patch("hindclaw_ext.http.db") as mock_db:
        pool = AsyncMock()
        mock_db.get_pool = AsyncMock(return_value=pool)
        yield mock_db, pool


@pytest.fixture
def mock_db_pool_with_tx():
    """Patch hindclaw_ext.http.db and yield (mock_db, pool, conn).

    Like mock_db_pool but also mocks pool.acquire() -> conn with transaction
    support. Used by tests for delete_user/delete_group cascade.
    """
    with patch("hindclaw_ext.http.db") as mock_db:
        pool = AsyncMock()
        mock_db.get_pool = AsyncMock(return_value=pool)

        conn = AsyncMock()
        conn.transaction = MagicMock(return_value=AsyncMock())

        @asynccontextmanager
        async def fake_acquire():
            yield conn

        pool.acquire = fake_acquire

        yield mock_db, pool, conn


def test_no_auth_returns_401(client):
    """Missing Authorization header returns 401."""
    resp = client.get("/ext/hindclaw/users")
    assert resp.status_code == 401


def test_bad_client_id_returns_401(client):
    """JWT with unknown client_id returns 401."""
    token = _make_admin_jwt(client_id="hacker")
    resp = client.get("/ext/hindclaw/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_create_user(client, admin_headers, mock_db_pool):
    """POST /ext/hindclaw/users creates a user."""
    _, pool = mock_db_pool
    resp = client.post(
        "/ext/hindclaw/users",
        json={"id": "alice", "display_name": "Alice", "email": "alice@example.com"},
        headers=admin_headers,
    )
    assert resp.status_code == 201


def test_list_users(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/users returns user list."""
    _, pool = mock_db_pool
    pool.fetch = AsyncMock(return_value=[
        {"id": "alice", "display_name": "Alice", "email": "alice@example.com"},
    ])

    resp = client.get("/ext/hindclaw/users", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == "alice"


def test_delete_user_cascades(client, admin_headers, mock_db_pool_with_tx):
    """DELETE /ext/hindclaw/users/:id cleans up related rows in a transaction."""
    _, pool, conn = mock_db_pool_with_tx
    pool.fetchval = AsyncMock(return_value="alice")  # user exists

    resp = client.delete("/ext/hindclaw/users/alice", headers=admin_headers)
    assert resp.status_code == 204

    # Verify cascade deletes were called on the connection (inside transaction)
    sql_calls = [c.args[0] for c in conn.execute.call_args_list if c.args]
    assert any("hindclaw_bank_permissions" in sql for sql in sql_calls)
    assert any("hindclaw_strategy_scopes" in sql for sql in sql_calls)
    assert any("hindclaw_users" in sql for sql in sql_calls)


def test_get_user_not_found(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/users/:id returns 404 for unknown user."""
    _, pool = mock_db_pool
    pool.fetchrow = AsyncMock(return_value=None)

    resp = client.get("/ext/hindclaw/users/nobody", headers=admin_headers)
    assert resp.status_code == 404


def test_create_group(client, admin_headers, mock_db_pool):
    """POST /ext/hindclaw/groups creates a group."""
    _, pool = mock_db_pool
    resp = client.post(
        "/ext/hindclaw/groups",
        json={"id": "engineering", "display_name": "Engineering", "recall": True, "retain": True},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["id"] == "engineering"


def test_get_group(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/groups/:id returns group with all GroupResponse fields."""
    _, pool = mock_db_pool
    pool.fetchrow = AsyncMock(return_value={
        "id": "engineering", "display_name": "Engineering",
        "recall": True, "retain": True, "retain_roles": None,
        "retain_tags": '["department:engineering"]',
        "retain_every_n_turns": None, "recall_budget": "low",
        "recall_max_tokens": None, "recall_tag_groups": None,
        "llm_model": None, "llm_provider": None,
        "exclude_providers": None, "retain_strategy": None,
    })

    resp = client.get("/ext/hindclaw/groups/engineering", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "engineering"
    assert data["recall"] is True
    assert data["recall_budget"] == "low"
    # JSONB string parsed into Python list by _row_to_group
    assert data["retain_tags"] == ["department:engineering"]
    assert "retain_strategy" in data
    assert "retain_roles" in data


def test_get_group_not_found(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/groups/:id returns 404 for unknown group."""
    _, pool = mock_db_pool
    pool.fetchrow = AsyncMock(return_value=None)

    resp = client.get("/ext/hindclaw/groups/nonexistent", headers=admin_headers)
    assert resp.status_code == 404


def test_upsert_bank_permission(client, admin_headers):
    """PUT /ext/hindclaw/banks/:bank/permissions/groups/:group upserts permission."""
    with patch("hindclaw_ext.http._upsert_bank_permission", new_callable=AsyncMock) as mock_upsert:
        mock_upsert.return_value = {"bank_id": "agent-alpha", "scope_type": "group", "scope_id": "engineering"}

        resp = client.put(
            "/ext/hindclaw/banks/agent-alpha/permissions/groups/engineering",
            json={"recall": True, "retain": False},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        mock_upsert.assert_called_once()


def test_upsert_strategy(client, admin_headers, mock_db_pool):
    """PUT /ext/hindclaw/banks/:bank/strategies/:scope_type/:scope_value sets strategy."""
    _, pool = mock_db_pool
    resp = client.put(
        "/ext/hindclaw/banks/agent-alpha/strategies/topic/500001",
        json={"strategy": "conversation"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["strategy"] == "conversation"


def test_create_api_key(client, admin_headers, mock_db_pool):
    """POST /ext/hindclaw/users/:id/api-keys generates a key."""
    _, pool = mock_db_pool
    resp = client.post(
        "/ext/hindclaw/users/alice/api-keys",
        json={"description": "Claude Code MCP"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["api_key"].startswith("hc_alice_")
    assert data["description"] == "Claude Code MCP"


def test_debug_resolve(client, admin_headers):
    """GET /ext/hindclaw/debug/resolve returns resolved permissions."""
    from hindclaw_ext.models import ResolvedPermissions

    mock_perms = ResolvedPermissions(user_id="alice", is_anonymous=False, recall=True)

    with (
        patch("hindclaw_ext.http.db") as mock_db,
        patch("hindclaw_ext.http.resolver.resolve", new_callable=AsyncMock, return_value=mock_perms),
    ):
        mock_db.get_user_by_channel = AsyncMock(return_value=None)

        resp = client.get(
            "/ext/hindclaw/debug/resolve?bank=agent-alpha&sender=telegram:100001",
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["recall"] is True


def test_debug_resolve_bad_sender(client, admin_headers):
    """GET /ext/hindclaw/debug/resolve with malformed sender returns 400."""
    resp = client.get(
        "/ext/hindclaw/debug/resolve?bank=agent-alpha&sender=no_colon",
        headers=admin_headers,
    )
    assert resp.status_code == 400


# --- Channel tests ---


def test_list_user_channels(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/users/:id/channels returns channel list."""
    _, pool = mock_db_pool
    pool.fetch = AsyncMock(return_value=[
        {"provider": "telegram", "sender_id": "100001"},
        {"provider": "slack", "sender_id": "U100001"},
    ])

    resp = client.get("/ext/hindclaw/users/alice/channels", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2
    assert resp.json()[0] == {"provider": "telegram", "sender_id": "100001"}


def test_add_user_channel(client, admin_headers, mock_db_pool):
    """POST /ext/hindclaw/users/:id/channels adds a channel mapping."""
    _, pool = mock_db_pool
    resp = client.post(
        "/ext/hindclaw/users/alice/channels",
        json={"provider": "telegram", "sender_id": "100001"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    assert resp.json() == {"provider": "telegram", "sender_id": "100001"}


# --- Group member tests ---


def test_add_group_member(client, admin_headers, mock_db_pool):
    """POST /ext/hindclaw/groups/:id/members adds a member."""
    _, pool = mock_db_pool
    resp = client.post(
        "/ext/hindclaw/groups/engineering/members",
        json={"user_id": "alice"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    assert resp.json() == {"group_id": "engineering", "user_id": "alice"}


def test_list_group_members(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/groups/:id/members returns member list."""
    _, pool = mock_db_pool
    pool.fetch = AsyncMock(return_value=[{"user_id": "alice"}, {"user_id": "bob"}])

    resp = client.get("/ext/hindclaw/groups/engineering/members", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2


# --- Bank permission tests ---


def test_list_bank_permissions(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/banks/:bank/permissions returns permission list."""
    _, pool = mock_db_pool
    pool.fetch = AsyncMock(return_value=[
        {"bank_id": "agent-alpha", "scope_type": "group", "scope_id": "team-lead",
         "recall": True, "retain": False, "retain_roles": None, "retain_tags": None,
         "retain_every_n_turns": None, "recall_budget": None, "recall_max_tokens": None,
         "recall_tag_groups": None, "llm_model": None, "llm_provider": None,
         "exclude_providers": None, "retain_strategy": None},
    ])

    resp = client.get("/ext/hindclaw/banks/agent-alpha/permissions", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["scope_id"] == "team-lead"


# --- Strategy tests ---


def test_list_strategies(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/banks/:bank/strategies returns strategy list."""
    _, pool = mock_db_pool
    pool.fetch = AsyncMock(return_value=[
        {"bank_id": "agent-alpha", "scope_type": "topic", "scope_value": "500001", "strategy": "conversation"},
    ])

    resp = client.get("/ext/hindclaw/banks/agent-alpha/strategies", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()[0]["strategy"] == "conversation"


# --- Error case tests ---


def test_update_user_empty_body(client, admin_headers, mock_db_pool):
    """PUT /ext/hindclaw/users/:id with empty body returns 400."""
    resp = client.put("/ext/hindclaw/users/alice", json={}, headers=admin_headers)
    assert resp.status_code == 400


# --- Happy path: GET/PUT/DELETE by ID ---


def test_get_user(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/users/:id returns user."""
    _, pool = mock_db_pool
    pool.fetchrow = AsyncMock(return_value={"id": "alice", "display_name": "Alice", "email": "alice@example.com"})

    resp = client.get("/ext/hindclaw/users/alice", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == "alice"


def test_update_user(client, admin_headers, mock_db_pool):
    """PUT /ext/hindclaw/users/:id updates and returns full user."""
    _, pool = mock_db_pool
    pool.execute = AsyncMock(return_value="UPDATE 1")
    pool.fetchrow = AsyncMock(return_value={
        "id": "alice", "display_name": "Alice K.", "email": "alice@example.com",
    })

    resp = client.put(
        "/ext/hindclaw/users/alice",
        json={"display_name": "Alice K."},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "Alice K."
    assert resp.json()["email"] == "alice@example.com"


def test_update_user_not_found(client, admin_headers, mock_db_pool):
    """PUT /ext/hindclaw/users/:id returns 404 if user doesn't exist."""
    _, pool = mock_db_pool
    pool.fetchrow = AsyncMock(return_value=None)  # UPDATE RETURNING yields None

    resp = client.put(
        "/ext/hindclaw/users/nobody",
        json={"display_name": "Ghost"},
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_update_group(client, admin_headers, mock_db_pool):
    """PUT /ext/hindclaw/groups/:id updates group and returns full GroupResponse."""
    _, pool = mock_db_pool
    pool.execute = AsyncMock(return_value="UPDATE 1")
    pool.fetchrow = AsyncMock(return_value={
        "id": "engineering", "display_name": "Engineering",
        "recall": True, "retain": False, "retain_roles": None,
        "retain_tags": None, "retain_every_n_turns": None,
        "recall_budget": None, "recall_max_tokens": None,
        "recall_tag_groups": None, "llm_model": None,
        "llm_provider": None, "exclude_providers": None,
        "retain_strategy": None,
    })

    resp = client.put(
        "/ext/hindclaw/groups/engineering",
        json={"recall": True, "retain": False},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["recall"] is True
    assert "retain_strategy" in resp.json()


def test_delete_group(client, admin_headers, mock_db_pool_with_tx):
    """DELETE /ext/hindclaw/groups/:id cascades and deletes."""
    _, pool, conn = mock_db_pool_with_tx
    pool.fetchval = AsyncMock(return_value="engineering")

    resp = client.delete("/ext/hindclaw/groups/engineering", headers=admin_headers)
    assert resp.status_code == 204


def test_remove_user_channel(client, admin_headers, mock_db_pool):
    """DELETE /ext/hindclaw/users/:id/channels/:provider/:sender_id removes channel."""
    _, pool = mock_db_pool
    resp = client.delete(
        "/ext/hindclaw/users/alice/channels/telegram/100001",
        headers=admin_headers,
    )
    assert resp.status_code == 204


def test_remove_group_member(client, admin_headers, mock_db_pool):
    """DELETE /ext/hindclaw/groups/:id/members/:user_id removes member."""
    _, pool = mock_db_pool
    resp = client.delete(
        "/ext/hindclaw/groups/engineering/members/alice",
        headers=admin_headers,
    )
    assert resp.status_code == 204


def test_get_bank_permission(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/banks/:bank/permissions/:scope_type/:scope_id returns permission."""
    _, pool = mock_db_pool
    pool.fetchrow = AsyncMock(return_value={
        "bank_id": "agent-alpha", "scope_type": "group", "scope_id": "team-lead",
        "recall": True, "retain": False, "retain_roles": None, "retain_tags": None,
        "retain_every_n_turns": None, "recall_budget": None, "recall_max_tokens": None,
        "recall_tag_groups": None, "llm_model": None, "llm_provider": None,
        "exclude_providers": None, "retain_strategy": None,
    })

    resp = client.get(
        "/ext/hindclaw/banks/agent-alpha/permissions/group/team-lead",
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["recall"] is True


def test_get_bank_permission_not_found(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/banks/:bank/permissions/:scope_type/:scope_id returns 404."""
    _, pool = mock_db_pool
    pool.fetchrow = AsyncMock(return_value=None)

    resp = client.get(
        "/ext/hindclaw/banks/agent-alpha/permissions/user/nobody",
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_delete_bank_permission(client, admin_headers, mock_db_pool):
    """DELETE /ext/hindclaw/banks/:bank/permissions/:scope_type/:scope_id deletes."""
    _, pool = mock_db_pool
    resp = client.delete(
        "/ext/hindclaw/banks/agent-alpha/permissions/group/team-lead",
        headers=admin_headers,
    )
    assert resp.status_code == 204


def test_delete_strategy(client, admin_headers, mock_db_pool):
    """DELETE /ext/hindclaw/banks/:bank/strategies/:scope_type/:scope_value deletes."""
    _, pool = mock_db_pool
    resp = client.delete(
        "/ext/hindclaw/banks/agent-alpha/strategies/topic/500001",
        headers=admin_headers,
    )
    assert resp.status_code == 204


def test_list_api_keys(client, admin_headers, mock_db_pool):
    """GET /ext/hindclaw/users/:id/api-keys returns keys with masked values."""
    _, pool = mock_db_pool
    pool.fetch = AsyncMock(return_value=[
        {"id": "k1", "api_key": "hc_alice_xxxxxxxxxxxx", "description": "test"},
    ])

    resp = client.get("/ext/hindclaw/users/alice/api-keys", headers=admin_headers)
    assert resp.status_code == 200
    assert "api_key_prefix" in resp.json()[0]
    assert resp.json()[0]["api_key_prefix"].startswith("hc_alice_")
    assert "api_key" not in resp.json()[0]  # full key not exposed in list


def test_delete_api_key(client, admin_headers, mock_db_pool):
    """DELETE /ext/hindclaw/users/:id/api-keys/:key_id deletes key."""
    _, pool = mock_db_pool
    resp = client.delete(
        "/ext/hindclaw/users/alice/api-keys/k1",
        headers=admin_headers,
    )
    assert resp.status_code == 204


def test_create_user_duplicate(client, admin_headers, mock_db_pool):
    """POST /ext/hindclaw/users with existing ID returns 409."""
    import asyncpg as _asyncpg

    _, pool = mock_db_pool
    pool.execute = AsyncMock(side_effect=_asyncpg.UniqueViolationError("duplicate"))

    resp = client.post(
        "/ext/hindclaw/users",
        json={"id": "alice", "display_name": "Alice"},
        headers=admin_headers,
    )
    assert resp.status_code == 409
