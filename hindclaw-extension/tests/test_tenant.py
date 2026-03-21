"""Tests for hindclaw_ext.tenant — HindclawTenant extension."""
import time
from unittest.mock import patch

import jwt as pyjwt
import pytest

from hindsight_api.extensions import AuthenticationError

from hindclaw_ext.models import ApiKeyRecord, UserRecord
from hindclaw_ext.tenant import HindclawTenant, _jwt_claims
from tests.helpers import FakeRequestContext

TEST_SECRET = "test-secret-key-for-tenant-tests"


@pytest.fixture(autouse=True)
def _set_jwt_secret(monkeypatch):
    """Ensure tests use test secret, not any real HINDCLAW_JWT_SECRET on this host."""
    monkeypatch.setenv("HINDCLAW_JWT_SECRET", TEST_SECRET)


@pytest.fixture(autouse=True)
def _reset_jwt_claims():
    """Reset _jwt_claims contextvar between tests to prevent state leakage."""
    _jwt_claims.set({})
    yield
    _jwt_claims.set({})


def _make_jwt(claims: dict, secret: str = TEST_SECRET) -> str:
    return pyjwt.encode(claims, secret, algorithm="HS256")


@pytest.mark.asyncio
async def test_jwt_auth_known_sender():
    """JWT with known sender resolves to user_id."""
    tenant = HindclawTenant({})
    token = _make_jwt({
        "client_id": "app-prod",
        "sender": "telegram:100001",
        "agent": "agent-alpha",
        "exp": int(time.time()) + 300,
    })
    ctx = FakeRequestContext(api_key=token)
    user = UserRecord(id="alice", display_name="Alice", email=None)

    with patch("hindclaw_ext.tenant.db.get_user_by_channel", return_value=user):
        result = await tenant.authenticate(ctx)

    assert ctx.tenant_id == "alice"
    assert result.schema_name == "public"
    # JWT claims stored in contextvar
    claims = _jwt_claims.get({})
    assert claims["agent"] == "agent-alpha"


@pytest.mark.asyncio
async def test_jwt_auth_unknown_sender():
    """JWT with unknown sender sets tenant_id to _anonymous."""
    tenant = HindclawTenant({})
    token = _make_jwt({
        "sender": "telegram:999999",
        "exp": int(time.time()) + 300,
    })
    ctx = FakeRequestContext(api_key=token)

    with patch("hindclaw_ext.tenant.db.get_user_by_channel", return_value=None):
        result = await tenant.authenticate(ctx)

    assert ctx.tenant_id == "_anonymous"
    assert result.schema_name == "public"


@pytest.mark.asyncio
async def test_jwt_auth_no_sender():
    """JWT without sender field sets tenant_id to _admin."""
    tenant = HindclawTenant({})
    token = _make_jwt({
        "client_id": "terraform-ci",
        "exp": int(time.time()) + 300,
    })
    ctx = FakeRequestContext(api_key=token)

    result = await tenant.authenticate(ctx)
    assert ctx.tenant_id == "_admin"


@pytest.mark.asyncio
async def test_api_key_auth():
    """API key resolves to user via DB lookup."""
    tenant = HindclawTenant({})
    ctx = FakeRequestContext(api_key="hc_alice_xxxx")
    key_record = ApiKeyRecord(id="k1", api_key="hc_alice_xxxx", user_id="alice")

    with patch("hindclaw_ext.tenant.db.get_api_key", return_value=key_record):
        result = await tenant.authenticate(ctx)

    assert ctx.tenant_id == "alice"
    assert result.schema_name == "public"


@pytest.mark.asyncio
async def test_api_key_invalid():
    """Invalid API key raises AuthenticationError."""
    tenant = HindclawTenant({})
    ctx = FakeRequestContext(api_key="hc_bad_key")

    with patch("hindclaw_ext.tenant.db.get_api_key", return_value=None):
        with pytest.raises(AuthenticationError, match="Invalid API key"):
            await tenant.authenticate(ctx)


@pytest.mark.asyncio
async def test_missing_token():
    """No token raises AuthenticationError."""
    tenant = HindclawTenant({})
    ctx = FakeRequestContext(api_key=None)

    with pytest.raises(AuthenticationError, match="Missing"):
        await tenant.authenticate(ctx)


@pytest.mark.asyncio
async def test_expired_jwt():
    """Expired JWT raises AuthenticationError."""
    tenant = HindclawTenant({})
    token = _make_jwt({"exp": int(time.time()) - 10})
    ctx = FakeRequestContext(api_key=token)

    with pytest.raises(AuthenticationError, match="expired"):
        await tenant.authenticate(ctx)
