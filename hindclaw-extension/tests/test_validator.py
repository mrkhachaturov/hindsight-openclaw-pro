"""Tests for hindclaw_ext.validator — HindclawValidator extension."""
from unittest.mock import patch

import pytest

from hindclaw_ext.models import ResolvedPermissions
from hindclaw_ext.validator import HindclawValidator
from hindclaw_ext.tenant import _jwt_claims
from tests.helpers import FakeRecallContext, FakeRetainContext, FakeReflectContext


@pytest.fixture(autouse=True)
def _set_jwt_secret(monkeypatch):
    """Ensure HINDCLAW_JWT_SECRET is set (validator imports tenant which imports auth)."""
    monkeypatch.setenv("HINDCLAW_JWT_SECRET", "test-secret-key-for-validator-tests")


@pytest.fixture(autouse=True)
def _reset_jwt_claims():
    """Reset _jwt_claims contextvar between tests to prevent state leakage."""
    _jwt_claims.set({})
    yield
    _jwt_claims.set({})


@pytest.mark.asyncio
async def test_recall_accepted_with_tag_groups():
    """Recall accepted with tag_groups enrichment, parsed into TagGroup models."""
    validator = HindclawValidator({})
    ctx = FakeRecallContext()

    perms = ResolvedPermissions(
        user_id="alice", is_anonymous=False,
        recall=True,
        recall_tag_groups=[{"not": {"tags": ["restricted"], "match": "any_strict"}}],
    )

    _jwt_claims.set({"agent": "agent-alpha", "topic": "500001"})

    with patch("hindclaw_ext.validator.resolver.resolve", return_value=perms):
        result = await validator.validate_recall(ctx)

    assert result.allowed is True
    assert result.tag_groups is not None
    assert len(result.tag_groups) == 1
    # Verify raw dicts were parsed into TagGroup Pydantic models (not raw dicts)
    from hindsight_api.engine.search.tags import TagGroupNot
    assert isinstance(result.tag_groups[0], TagGroupNot)


@pytest.mark.asyncio
async def test_recall_denied():
    """Recall denied returns reject."""
    validator = HindclawValidator({})
    ctx = FakeRecallContext(tenant_id="unknown")

    perms = ResolvedPermissions(user_id="unknown", is_anonymous=False, recall=False)

    _jwt_claims.set({})

    with patch("hindclaw_ext.validator.resolver.resolve", return_value=perms):
        result = await validator.validate_recall(ctx)

    assert result.allowed is False
    assert "recall denied" in result.reason


@pytest.mark.asyncio
async def test_retain_accepted_with_enrichment():
    """Retain accepted with tag injection and strategy."""
    validator = HindclawValidator({})
    ctx = FakeRetainContext(contents=[
        {"content": "conversation", "tags": ["existing:tag"]},
    ])

    perms = ResolvedPermissions(
        user_id="alice", is_anonymous=False,
        retain=True,
        retain_tags=["user:alice", "department:engineering"],
        retain_strategy="conversation",
    )

    _jwt_claims.set({"agent": "agent-alpha"})

    with patch("hindclaw_ext.validator.resolver.resolve", return_value=perms):
        result = await validator.validate_retain(ctx)

    assert result.allowed is True
    assert result.contents is not None
    # Existing tags preserved + new tags added
    assert "existing:tag" in result.contents[0]["tags"]
    assert "user:alice" in result.contents[0]["tags"]
    assert "department:engineering" in result.contents[0]["tags"]
    # Strategy set
    assert result.contents[0]["strategy"] == "conversation"


@pytest.mark.asyncio
async def test_retain_denied():
    """Retain denied returns reject."""
    validator = HindclawValidator({})
    ctx = FakeRetainContext()

    perms = ResolvedPermissions(user_id="alice", is_anonymous=False, retain=False)

    _jwt_claims.set({})

    with patch("hindclaw_ext.validator.resolver.resolve", return_value=perms):
        result = await validator.validate_retain(ctx)

    assert result.allowed is False


@pytest.mark.asyncio
async def test_retain_no_existing_tags():
    """Retain works when content has no existing tags (None)."""
    validator = HindclawValidator({})
    ctx = FakeRetainContext(contents=[{"content": "test"}])

    perms = ResolvedPermissions(
        user_id="alice", is_anonymous=False,
        retain=True,
        retain_tags=["user:alice"],
    )

    _jwt_claims.set({})

    with patch("hindclaw_ext.validator.resolver.resolve", return_value=perms):
        result = await validator.validate_retain(ctx)

    assert result.contents[0]["tags"] == ["user:alice"]


@pytest.mark.asyncio
async def test_reflect_uses_recall_permission():
    """Reflect access follows recall permission."""
    validator = HindclawValidator({})

    # Reflect allowed (recall=True)
    perms = ResolvedPermissions(user_id="alice", is_anonymous=False, recall=True)
    ctx = FakeReflectContext()
    _jwt_claims.set({})

    with patch("hindclaw_ext.validator.resolver.resolve", return_value=perms):
        result = await validator.validate_reflect(ctx)
    assert result.allowed is True

    # Reflect denied (recall=False)
    perms = ResolvedPermissions(user_id="alice", is_anonymous=False, recall=False)
    with patch("hindclaw_ext.validator.resolver.resolve", return_value=perms):
        result = await validator.validate_reflect(ctx)
    assert result.allowed is False


@pytest.mark.asyncio
async def test_recall_no_tag_groups():
    """Recall with no tag_groups returns accept (not accept_with)."""
    validator = HindclawValidator({})
    ctx = FakeRecallContext()

    perms = ResolvedPermissions(
        user_id="alice", is_anonymous=False,
        recall=True,
        recall_tag_groups=None,
    )
    _jwt_claims.set({})

    with patch("hindclaw_ext.validator.resolver.resolve", return_value=perms):
        result = await validator.validate_recall(ctx)

    assert result.allowed is True
    assert result.tag_groups is None  # no enrichment
