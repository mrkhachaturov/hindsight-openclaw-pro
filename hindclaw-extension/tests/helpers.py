"""Test utilities — mock asyncpg Record and fake context objects."""
from dataclasses import dataclass


@dataclass
class MockRecord:
    """Simulate asyncpg Record for unit tests."""
    _data: dict

    def __getitem__(self, key):
        return self._data[key]

    def get(self, key, default=None):
        return self._data.get(key, default)


def make_records(rows: list[dict]) -> list[MockRecord]:
    """Convert list of dicts to list of MockRecord."""
    return [MockRecord(r) for r in rows]


class FakeRequestContext:
    """Minimal RequestContext mock for tenant/validator tests."""

    def __init__(self, api_key: str | None = None, tenant_id: str | None = None):
        self.api_key = api_key
        self.tenant_id = tenant_id


class FakeRecallContext:
    """Fake RecallContext for validator tests."""

    def __init__(self, bank_id: str = "agent-alpha", tenant_id: str = "alice"):
        self.bank_id = bank_id
        self.request_context = FakeRequestContext(tenant_id=tenant_id)


class FakeRetainContext:
    """Fake RetainContext for validator tests."""

    def __init__(self, bank_id: str = "agent-alpha", tenant_id: str = "alice", contents: list[dict] | None = None):
        self.bank_id = bank_id
        self.request_context = FakeRequestContext(tenant_id=tenant_id)
        self.contents = contents or [{"content": "test conversation", "tags": ["existing:tag"]}]


class FakeReflectContext:
    """Fake ReflectContext for validator tests."""

    def __init__(self, bank_id: str = "agent-alpha", tenant_id: str = "alice"):
        self.bank_id = bank_id
        self.request_context = FakeRequestContext(tenant_id=tenant_id)
