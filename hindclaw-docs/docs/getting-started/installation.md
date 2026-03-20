---
sidebar_position: 1
title: Installation
---

# Installation

This guide walks you through installing hindclaw and its dependencies, configuring the Hindsight daemon, enabling the plugin in your OpenClaw gateway, and (for multi-user setups) installing the server-side extension.

## Prerequisites

Before you begin, make sure you have:

- **Python 3.11+** -- Hindsight's daemon (`hindsight-embed`) is a Python application
- **uv** -- Python package installer and tool manager ([docs.astral.sh/uv](https://docs.astral.sh/uv/))
- **Node.js 22+** -- hindclaw is a Node.js plugin
- **OpenClaw** -- a running gateway with `openclaw` CLI available

Check your versions:

```bash
python3 --version   # 3.11 or higher
uv --version        # any recent version
node --version      # 22 or higher
openclaw --version  # any recent version
```

## Step 1: Install and configure hindsight-embed

`hindsight-embed` is the local Hindsight daemon. It runs the memory engine -- storing facts, building the knowledge graph, and serving recall queries.

Install it as a uv tool (globally available, isolated environment):

```bash
uv tool install hindsight-embed
```

Then create a named profile for OpenClaw. The profile stores the daemon's port, database path, and LLM settings:

```bash
hindsight-embed configure -p openclaw
```

This walks you through an interactive setup. The key settings:

| Setting | Description | Typical value |
|---------|-------------|---------------|
| API port | Port the daemon listens on | `9077` |
| Database | Where memories are stored | `~/.hindsight/openclaw/` |
| LLM provider | Used for fact extraction and reflection | `anthropic`, `openai`, etc. |

The profile name `openclaw` matters -- hindclaw uses it to manage the daemon lifecycle.

## Step 2: Install the hindclaw plugin

```bash
openclaw plugins install hindclaw
```

This downloads the plugin from npm and registers it in your OpenClaw config.

## Step 3: Configure the plugin

Add the hindclaw plugin to your `openclaw.json` (or to a `$include`'d plugins config file). The minimal configuration:

```json5
{
  "plugins": {
    "slots": {
      "memory": "hindclaw"
    },
    "entries": {
      "hindclaw": {
        "enabled": true,
        "config": {
          "dynamicBankGranularity": ["agent"],
          "bootstrap": true
        }
      }
    }
  }
}
```

What each field does:

- **`slots.memory`** -- tells OpenClaw that hindclaw occupies the memory slot (only one memory plugin can be active)
- **`dynamicBankGranularity`** -- controls how bank IDs are derived from context. `["agent"]` means one bank per agent (recommended starting point). Other options include `["agent", "channel"]` or `["agent", "channel", "user"]` for finer granularity.
- **`bootstrap`** -- when `true`, the plugin automatically applies bank config files to Hindsight on first run. This means you do not need to manually run `hindclaw apply` for initial setup.

### Optional: external Hindsight server (single-user)

If you are running a remote Hindsight server and do not need multi-user access control, add the server URL and a static API token:

```json5
{
  "plugins": {
    "entries": {
      "hindclaw": {
        "enabled": true,
        "config": {
          "dynamicBankGranularity": ["agent"],
          "bootstrap": true,
          "hindsightApiUrl": "https://hindsight.your-server.local",
          "hindsightApiToken": "your-api-token"
        }
      }
    }
  }
}
```

When `hindsightApiUrl` is set, the plugin connects to that server directly and does not start a local daemon.

### Optional: external Hindsight server (multi-user with hindclaw-extension)

If the server is running the hindclaw-extension (see Step 4 below), use `jwtSecret` instead of `hindsightApiToken`. The plugin will generate short-lived JWTs for each request:

```json5
{
  "plugins": {
    "entries": {
      "hindclaw": {
        "enabled": true,
        "config": {
          "dynamicBankGranularity": ["agent"],
          "bootstrap": true,
          "hindsightApiUrl": "https://hindsight.your-server.local",
          "jwtSecret": "shared-secret-between-plugin-and-server"
        }
      }
    }
  }
}
```

The `jwtSecret` must match the `HINDSIGHT_API_TENANT_JWT_SECRET` environment variable configured on the server.

## Step 4: Install hindclaw-extension on the server (multi-user only)

This step is **required for multi-user setups** where you need access control, per-user permissions, and server-side enrichment. For single-user setups, the extension is optional -- the plugin works without it using a static API token.

The hindclaw-extension is a Python package that installs three Hindsight server extensions (tenant authentication, operation validation, and an HTTP management API). Install it on the machine running the Hindsight API server:

```bash
pip install hindclaw-extension
```

Then configure the server environment variables to load the extensions:

```bash
# Extension classes
HINDSIGHT_API_TENANT_EXTENSION=hindclaw_ext.tenant:HindclawTenant
HINDSIGHT_API_OPERATION_VALIDATOR_EXTENSION=hindclaw_ext.validator:HindclawValidator
HINDSIGHT_API_HTTP_EXTENSION=hindclaw_ext.http:HindclawHttp

# Shared secret for JWT validation (must match jwtSecret in plugin config)
HINDSIGHT_API_TENANT_JWT_SECRET=shared-secret-between-plugin-and-server

# Optional: admin client IDs for CRUD API access
HINDSIGHT_API_TENANT_ADMIN_CLIENTS=openclaw-prod
```

The extensions use the same PostgreSQL database as Hindsight core (`HINDSIGHT_API_DATABASE_URL`). Tables are created automatically on startup via `CREATE TABLE IF NOT EXISTS`.

After configuring the env vars, restart the Hindsight API server. You should see startup logs confirming the extensions loaded.

Once the extension is running, manage users, groups, and permissions via the `/ext/hindclaw/*` REST API. See the [Access Control guide](../guides/access-control) and the [Configuration Reference](../reference/configuration) for details.

## Step 5: Restart the gateway

```bash
openclaw gateway
```

Or if you are running via systemd:

```bash
just restart
```

Watch the logs for confirmation that hindclaw initialized:

```bash
just logs
```

You should see lines like:

```
[Hindsight] Plugin initialized
[Hindsight] Bootstrap: checking bank yoda config...
[Hindsight] Bootstrap: applying 5 config fields to bank yoda
```

If you see errors about the daemon not running, verify that `hindsight-embed` is installed and the `openclaw` profile was configured correctly:

```bash
hindsight-embed -p openclaw status
```

## Next steps

Your gateway is running with hindclaw enabled, but it does not have any bank configurations yet. Agents will use default extraction behavior.

Next: [Create your first bank config](./first-bank.md) to define how an agent should extract and organize memories.
