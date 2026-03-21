# Hindclaw TypeScript Client

Generated TypeScript client for the Hindclaw access control API.

## Installation

```bash
npm install @hindclaw/client
```

## Usage

```typescript
import { createClient } from '@hindclaw/client'

const client = createClient({
  baseUrl: 'https://hindsight.home.local',
  headers: { Authorization: `Bearer ${apiKey}` },
})

const { data: users } = await client.GET('/ext/hindclaw/users')
const { data: groups } = await client.GET('/ext/hindclaw/groups')
```

## Regenerating

```bash
cd build/hindclaw
python scripts/extract-openapi.py > hindclaw-clients/openapi.json
bash scripts/generate-clients.sh
```
