"""Tests for hindclaw_ext.resolver — 4-step permission resolution."""
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch

from hindclaw_ext.models import GroupRecord, BankPermissionRecord, ResolvedPermissions
from hindclaw_ext.resolver import resolve


@pytest.mark.asyncio
async def test_anonymous_user_denied():
    """Anonymous users get _default group permissions (deny all)."""
    default_group = GroupRecord(id="_default", display_name="Anonymous", recall=False, retain=False)
    with (
        patch("hindclaw_ext.resolver.db.get_default_group", return_value=default_group),
        patch("hindclaw_ext.resolver.db.get_user_groups", return_value=[]),
        patch("hindclaw_ext.resolver.db.get_bank_permissions", return_value=[]),
        patch("hindclaw_ext.resolver.db.resolve_strategy", return_value=None),
    ):
        perms = await resolve(user_id="_anonymous", bank_id="agent-alpha")
        assert perms.is_anonymous is True
        assert perms.recall is False
        assert perms.retain is False


@pytest.mark.asyncio
async def test_user_with_global_groups():
    """User in groups gets merged global permissions."""
    groups = [
        GroupRecord(id="team-lead", display_name="Team Lead", recall=True, retain=True,
                    retain_tags=["role:team-lead"], recall_budget="mid"),
        GroupRecord(id="engineering", display_name="Motors", recall=True, retain=True,
                    retain_tags=["department:engineering"], recall_budget="low"),
    ]
    with (
        patch("hindclaw_ext.resolver.db.get_default_group", return_value=GroupRecord(id="_default", display_name="Anon")),
        patch("hindclaw_ext.resolver.db.get_user_groups", return_value=groups),
        patch("hindclaw_ext.resolver.db.get_bank_permissions", return_value=[]),
        patch("hindclaw_ext.resolver.db.resolve_strategy", return_value=None),
    ):
        perms = await resolve(user_id="alice", bank_id="agent-alpha")
        assert perms.recall is True
        assert perms.retain is True
        # Tags unioned
        assert "role:team-lead" in perms.retain_tags
        assert "department:engineering" in perms.retain_tags
        # Auto user tag appended
        assert "user:alice" in perms.retain_tags
        # Budget: most permissive (mid > low)
        assert perms.recall_budget == "mid"


@pytest.mark.asyncio
async def test_bank_level_override():
    """Bank-level permission overrides global group defaults."""
    groups = [
        GroupRecord(id="team-lead", display_name="Team Lead", recall=True, retain=True),
    ]
    bank_perms = [
        BankPermissionRecord(bank_id="agent-alpha", scope_type="group", scope_id="team-lead",
                             recall=True, retain=False),
    ]
    with (
        patch("hindclaw_ext.resolver.db.get_default_group", return_value=GroupRecord(id="_default", display_name="Anon")),
        patch("hindclaw_ext.resolver.db.get_user_groups", return_value=groups),
        patch("hindclaw_ext.resolver.db.get_bank_permissions", return_value=bank_perms),
        patch("hindclaw_ext.resolver.db.resolve_strategy", return_value=None),
    ):
        perms = await resolve(user_id="alice", bank_id="agent-alpha")
        assert perms.recall is True
        assert perms.retain is False  # overridden at bank level


@pytest.mark.asyncio
async def test_bank_user_override():
    """Per-user bank override takes precedence over group."""
    groups = [
        GroupRecord(id="engineering", display_name="Motors", recall=True, retain=True),
    ]
    bank_perms = [
        BankPermissionRecord(bank_id="agent-alpha", scope_type="group", scope_id="engineering",
                             recall=True, retain=True),
        BankPermissionRecord(bank_id="agent-alpha", scope_type="user", scope_id="alice",
                             recall=True, retain=False),
    ]
    with (
        patch("hindclaw_ext.resolver.db.get_default_group", return_value=GroupRecord(id="_default", display_name="Anon")),
        patch("hindclaw_ext.resolver.db.get_user_groups", return_value=groups),
        patch("hindclaw_ext.resolver.db.get_bank_permissions", return_value=bank_perms),
        patch("hindclaw_ext.resolver.db.resolve_strategy", return_value=None),
    ):
        perms = await resolve(user_id="alice", bank_id="agent-alpha")
        assert perms.retain is False  # per-user override wins


@pytest.mark.asyncio
async def test_strategy_cascade():
    """Strategy comes from the cascade, not from permission merge."""
    groups = [GroupRecord(id="engineering", display_name="Motors", recall=True, retain=True)]
    with (
        patch("hindclaw_ext.resolver.db.get_default_group", return_value=GroupRecord(id="_default", display_name="Anon")),
        patch("hindclaw_ext.resolver.db.get_user_groups", return_value=groups),
        patch("hindclaw_ext.resolver.db.get_bank_permissions", return_value=[]),
        patch("hindclaw_ext.resolver.db.resolve_strategy", return_value="conversation"),
    ):
        perms = await resolve(
            user_id="alice", bank_id="agent-alpha",
            agent="agent-alpha", channel="telegram", topic="500001",
        )
        assert perms.retain_strategy == "conversation"


@pytest.mark.asyncio
async def test_recall_tag_groups_anded():
    """Tag groups from multiple groups are AND-ed together."""
    groups = [
        GroupRecord(id="team-lead", display_name="DH",
                    recall_tag_groups=[{"not": {"tags": ["restricted"], "match": "any_strict"}}]),
        GroupRecord(id="engineering", display_name="Motors",
                    recall_tag_groups=[{"tags": ["department:engineering"], "match": "any_strict"}]),
    ]
    with (
        patch("hindclaw_ext.resolver.db.get_default_group", return_value=GroupRecord(id="_default", display_name="Anon")),
        patch("hindclaw_ext.resolver.db.get_user_groups", return_value=groups),
        patch("hindclaw_ext.resolver.db.get_bank_permissions", return_value=[]),
        patch("hindclaw_ext.resolver.db.resolve_strategy", return_value=None),
    ):
        perms = await resolve(user_id="alice", bank_id="agent-alpha")
        # Both tag groups present (AND-ed)
        assert perms.recall_tag_groups is not None
        assert len(perms.recall_tag_groups) == 2


@pytest.mark.asyncio
async def test_no_bank_permissions_fallback():
    """Banks without hindclaw_bank_permissions rows use global group defaults."""
    groups = [
        GroupRecord(id="engineering", display_name="Motors", recall=True, retain=True),
    ]
    with (
        patch("hindclaw_ext.resolver.db.get_default_group", return_value=GroupRecord(id="_default", display_name="Anon")),
        patch("hindclaw_ext.resolver.db.get_user_groups", return_value=groups),
        patch("hindclaw_ext.resolver.db.get_bank_permissions", return_value=[]),
        patch("hindclaw_ext.resolver.db.resolve_strategy", return_value=None),
    ):
        perms = await resolve(user_id="bob", bank_id="agent-beta")
        assert perms.recall is True  # from global group
        assert perms.retain is True  # from global group
