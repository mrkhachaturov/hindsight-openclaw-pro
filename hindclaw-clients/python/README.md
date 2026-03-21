# Hindclaw Python Client

Generated async Python client for the Hindclaw access control API.

## Installation

```bash
pip install hindclaw-client
```

## Usage

```python
from hindclaw_client import HindclawClient

async with HindclawClient("https://hindsight.home.local", api_key="hc_admin_xxxxx") as client:
    users = await client.api.list_users()
    perms = await client.api.debug_resolve(bank="agent-alpha", sender="telegram:100001")
```

## Regenerating

```bash
cd build/hindclaw
python scripts/extract-openapi.py > hindclaw-clients/openapi.json
bash scripts/generate-clients.sh
```
