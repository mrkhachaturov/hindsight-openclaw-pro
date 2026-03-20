---
sidebar_position: 1
title: Installation
---

# Installation

This guide walks you through installing hindclaw and its dependencies, configuring the Hindsight daemon, and enabling the plugin in your OpenClaw gateway.

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

### Optional: external Hindsight server

If you are running a remote Hindsight server instead of the local daemon, add the server URL and token:

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

### Optional: configPath for separated config

For larger deployments, you can move hindclaw's configuration (access control groups, users, per-bank overrides) into a separate directory:

```json5
{
  "config": {
    "configPath": "./hindsight"
  }
}
```

This tells hindclaw to look for its config structure at `.openclaw/hindsight/` relative to your OpenClaw config directory. Run `hindclaw init` to scaffold the directory structure. See the [access control guide](/docs/guides/access-control) for details.

## Step 4: Restart the gateway

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
