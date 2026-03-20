---
sidebar_position: 1
title: Plugin Configuration
---

# Plugin Configuration Reference

HindClaw uses a two-level config system. Plugin-level defaults are set in `openclaw.json` (or its modular `$include` files). Per-agent overrides are set in bank config files (`banks/*.json5`).

**Resolution order:** plugin defaults → bank config file (shallow merge, bank file wins).

## Config Architecture

```
openclaw.json (plugin config)          banks/agent-1.json5 (bank config)
  Daemon (global only)                   Server-side (agent-only)
    apiPort, embedVersion                  retain_mission, entity_labels
    embedPackagePath, daemonIdleTimeout    dispositions, directives

  Defaults (overridable per-agent)       Infrastructure overrides
    hindsightApiUrl, hindsightApiToken     hindsightApiUrl, hindsightApiToken
    llmProvider, llmModel
    autoRecall, autoRetain, ...          Behavioral overrides
                                           recallBudget, retainTags, llmModel
  bootstrap: true|false
                                         Multi-bank: recallFrom [...]
  Agent mapping                          Session start: sessionStartModels
    agents: { id: { bankConfig } }       Reflect: reflectOnRecall
```

## Plugin Config Options

Set these in the `config` block of the HindClaw plugin entry inside `openclaw.json`.

### Infrastructure

| Option | Type | Default | Per-agent | Description |
|--------|------|---------|-----------|-------------|
| `hindsightApiUrl` | `string` | -- | yes | Hindsight API base URL. When set, connects to a remote server instead of the local daemon. |
| `hindsightApiToken` | `string` | -- | yes | Bearer token for API authentication. Required when using a remote server. |

### Daemon (Global Only)

These options control the embedded `hindsight-embed` daemon. They cannot be overridden per-agent.

| Option | Type | Default | Per-agent | Description |
|--------|------|---------|-----------|-------------|
| `apiPort` | `number` | `9077` | no | Port the local daemon listens on. |
| `embedVersion` | `string` | `"latest"` | no | Version of `hindsight-embed` to use. |
| `embedPackagePath` | `string` | -- | no | Path to a local `hindsight-embed` installation. For development only. |
| `daemonIdleTimeout` | `number` | `0` | no | Seconds of inactivity before the daemon shuts down. `0` means never. |

### Bank ID Routing

| Option | Type | Default | Per-agent | Description |
|--------|------|---------|-----------|-------------|
| `dynamicBankId` | `boolean` | `true` | yes | Derive the bank ID dynamically from context fields instead of using a static ID. |
| `dynamicBankGranularity` | `string[]` | `["agent","channel","user"]` | yes | Which context fields to include in the derived bank ID. Valid values: `agent`, `provider`, `channel`, `user`. |
| `bankIdPrefix` | `string` | -- | yes | Static prefix prepended to derived bank IDs. |

### Behavioral Defaults

These set the plugin-wide defaults. Any of them can be overridden in a bank config file.

| Option | Type | Default | Per-agent | Description |
|--------|------|---------|-----------|-------------|
| `autoRecall` | `boolean` | `true` | yes | Inject recalled memories into the prompt before each turn. |
| `autoRetain` | `boolean` | `true` | yes | Retain conversations after each agent turn. |
| `recallBudget` | `string` | `"mid"` | yes | Recall effort level. Values: `low`, `mid`, `high`. Higher values use more compute for better results. |
| `recallMaxTokens` | `number` | `1024` | yes | Maximum tokens injected into the prompt per recall. |
| `recallTypes` | `string[]` | `["world","experience"]` | yes | Memory types to recall. Values: `world`, `experience`, `observation`. |
| `recallRoles` | `string[]` | -- | yes | Roles to include in the recall query context. Values: `user`, `assistant`, `system`, `tool`. |
| `recallTopK` | `number` | -- | yes | Maximum number of memory results to return from recall. |
| `recallContextTurns` | `number` | -- | yes | Number of recent conversation turns to include as context in the recall query. |
| `recallMaxQueryChars` | `number` | -- | yes | Maximum character length of the recall query. |
| `recallPromptPreamble` | `string` | -- | yes | Text prepended to the recalled memories block before injection. |
| `retainRoles` | `string[]` | `["user","assistant"]` | yes | Message roles captured during retention. Values: `user`, `assistant`, `system`, `tool`. |
| `retainEveryNTurns` | `number` | `1` | yes | Retain every Nth turn. Set to `2` to retain every other turn, `3` for every third, etc. |
| `retainOverlapTurns` | `number` | -- | yes | Number of turns to overlap between consecutive retain windows. Prevents context loss at boundaries. |
| `excludeProviders` | `string[]` | `[]` | yes | Skip memory operations for these message providers (e.g., `["slack"]`). |
| `llmProvider` | `string` | auto | yes | LLM provider for memory extraction. Auto-detected from the gateway config if not set. |
| `llmModel` | `string` | provider default | yes | LLM model name for extraction. |
| `llmApiKeyEnv` | `string` | -- | yes | Environment variable name containing the LLM API key. |
| `debug` | `boolean` | `false` | yes | Enable debug logging for memory operations. |

### Bootstrap and Agent Map

| Option | Type | Default | Per-agent | Description |
|--------|------|---------|-----------|-------------|
| `bootstrap` | `boolean` | `false` | no | Automatically apply bank configs on first run when the bank is empty on the server. After the initial bootstrap, use `hindclaw apply` to manage server state. |
| `agents` | `Record<string, AgentEntry>` | `{}` | no | Per-agent bank config registration. Maps agent IDs to their bank config file paths. |
| `configPath` | `string` | -- | no | Path to `.openclaw/hindsight/` directory for auto-discovery of banks, groups, and user permissions (v2.0.0). |
| `bankMission` | `string` | -- | no | Default bank mission applied automatically to unconfigured banks. |

The `agents` map uses this structure:

```json5
{
  "agents": {
    "yoda":  { "bankConfig": "./banks/yoda.json5" },
    "r2d2":  { "bankConfig": "./banks/r2d2.json5" },
    "c3po":  { "bankConfig": "./banks/c3po.json5" }
  }
}
```

## Remote Server Setup

To connect an agent (or all agents) to a remote Hindsight server instead of the local daemon, set `hindsightApiUrl` and `hindsightApiToken`.

**Plugin-level** (all agents use the same remote server):

```json5
{
  "hindsightApiUrl": "https://hindsight.office.local",
  "hindsightApiToken": "your-api-token"
}
```

**Per-agent** (different agents connect to different servers):

```json5
// In banks/agent-3.json5
{
  "hindsightApiUrl": "https://hindsight.office.local",
  "hindsightApiToken": "office-api-token"
}
```

Multi-server topology example:

```
Gateway
  agent-1  (private)  -> hindsightApiUrl: "https://hindsight.home.local"
  agent-2  (private)  -> hindsightApiUrl: "https://hindsight.home.local"
  agent-3  (company)  -> hindsightApiUrl: "https://hindsight.office.local"
  agent-4  (company)  -> hindsightApiUrl: "https://hindsight.office.local"
  agent-5  (local)    -> no hindsightApiUrl (uses local daemon)
```

## Cross-Agent Recall

An agent can recall memories from other agents' banks by setting `recallFrom` in its bank config file. This is a bank config field, not a plugin config field.

```json5
// In banks/supervisor.json5
{
  "recallFrom": [
    { "bankId": "agent-1" },
    { "bankId": "agent-2", "budget": "high", "maxTokens": 2048 },
    { "bankId": "agent-3", "types": ["world"] }
  ]
}
```

Each entry in `recallFrom` supports:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bankId` | `string` | required | Target bank ID to recall from. |
| `budget` | `string` | inherits | Recall effort for this bank. Values: `low`, `mid`, `high`. |
| `maxTokens` | `number` | inherits | Max tokens from this bank. |
| `types` | `string[]` | inherits | Memory types to recall from this bank. |
| `tagGroups` | `TagGroup[]` | -- | Tag-based filtering for this bank's recall. |

When access control is active, permissions are checked independently for each target bank. If the requesting user has `recall: false` on a target bank, that bank is silently skipped.
