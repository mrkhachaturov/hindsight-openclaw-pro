"""Hindclaw access control extensions for Hindsight API.

Extensions are imported lazily — they depend on hindsight_api which is only
available when running inside the Hindsight server process. Core modules
(models, auth, db, resolver) can be imported without hindsight_api installed.
"""


def __getattr__(name: str):
    """Lazy import of extension classes to avoid hindsight_api dependency at import time."""
    if name == "HindclawTenant":
        from hindclaw_ext.tenant import HindclawTenant
        return HindclawTenant
    if name == "HindclawValidator":
        from hindclaw_ext.validator import HindclawValidator
        return HindclawValidator
    if name == "HindclawHttp":
        from hindclaw_ext.http import HindclawHttp
        return HindclawHttp
    raise AttributeError(f"module 'hindclaw_ext' has no attribute {name!r}")


__all__ = ["HindclawTenant", "HindclawValidator", "HindclawHttp"]
