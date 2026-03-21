"""Hindclaw Python client — convenience wrapper around generated API client.

Usage:
    from hindclaw_client import HindclawClient

    client = HindclawClient("https://hindsight.home.local", api_key="hc_admin_xxxxx")
    users = await client.list_users()
"""
from hindclaw_client_api import ApiClient, Configuration
from hindclaw_client_api.api import ExtensionApi


class HindclawClient:
    """Convenience wrapper around the generated Hindclaw API client.

    Args:
        base_url: Hindsight server URL.
        api_key: Hindclaw API key or JWT token.
    """

    def __init__(self, base_url: str, api_key: str):
        config = Configuration(host=base_url)
        config.api_key["HTTPBearer"] = api_key
        self._client = ApiClient(config)
        self.api = ExtensionApi(self._client)

    async def close(self):
        """Close the underlying HTTP client."""
        await self._client.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
