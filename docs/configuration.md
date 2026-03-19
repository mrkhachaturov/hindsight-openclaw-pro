# Configuration

HindClaw uses a two-level config system: plugin-level defaults in `openclaw.json` and per-agent overrides in bank config files.

```
openclaw.json (plugin config)          banks/atlas.json5 (bank config)
├── Daemon (global only)               ├── Server-side (agent-only)
│   apiPort, embedVersion              │   retain_mission, entity_labels
│   embedPackagePath, daemonIdleTimeout│   dispositions, directives
│                                      │
├── Defaults (overridable per-agent)   ├── Infrastructure overrides
│   hindsightApiUrl, hindsightApiToken │   hindsightApiUrl, hindsightApiToken
│   llmProvider, llmModel              │
│   autoRecall, autoRetain, ...        ├── Behavioral overrides
│                                      │   recallBudget, retainTags, llmModel
├── bootstrap: true|false              │
│                                      ├── Multi-bank: recallFrom [...]
└── Agent mapping                      ├── Session start: sessionStartModels
    agents: { id: { bankConfig } }     └── Reflect: reflectOnRecall
```

Resolution: plugin defaults -> bank config file (shallow merge, bank file wins).

## Plugin Config Reference

| Option | Default | Per-agent | Description |
|--------|---------|-----------|-------------|
| `hindsightApiUrl` | - | yes | Hindsight API URL |
| `hindsightApiToken` | - | yes | Bearer token for API auth |
| `apiPort` | `9077` | no | Port for local daemon |
| `embedVersion` | `"latest"` | no | `hindsight-embed` version |
| `embedPackagePath` | - | no | Local `hindsight-embed` path (development) |
| `daemonIdleTimeout` | `0` | no | Daemon idle timeout in seconds (0 = never) |
| `dynamicBankId` | `true` | yes | Derive bank ID from context |
| `dynamicBankGranularity` | `["agent","channel","user"]` | yes | Fields for bank ID derivation |
| `bankIdPrefix` | - | yes | Prefix for derived bank IDs |
| `autoRecall` | `true` | yes | Inject memories before each turn |
| `autoRetain` | `true` | yes | Retain conversations after each turn |
| `recallBudget` | `"mid"` | yes | Recall effort: `low`, `mid`, `high` |
| `recallMaxTokens` | `1024` | yes | Max tokens injected per turn |
| `recallTypes` | `["world","experience"]` | yes | Memory types to recall |
| `retainRoles` | `["user","assistant"]` | yes | Roles captured for retention |
| `retainEveryNTurns` | `1` | yes | Retain every Nth turn |
| `llmProvider` | auto | yes | LLM provider for extraction |
| `llmModel` | provider default | yes | Model name |
| `bootstrap` | `false` | no | Auto-apply bank configs on first run |
| `agents` | `{}` | no | Per-agent bank config registration |

## Multi-Server Support

Per-agent infrastructure overrides enable connecting different agents to different Hindsight servers:

```
Gateway
├── atlas    (private)  -> hindsightApiUrl: "https://hindsight.home.local"
├── health   (private)  -> hindsightApiUrl: "https://hindsight.home.local"
├── support  (company)  -> hindsightApiUrl: "https://hindsight.office.local"
├── sales    (company)  -> hindsightApiUrl: "https://hindsight.office.local"
└── dev      (local)    -> no hindsightApiUrl (local daemon)
```

## Remote Hindsight Server

To use a remote/shared Hindsight server instead of the local daemon:

```json5
{
  "hindsightApiUrl": "https://hindsight.office.local",
  "hindsightApiToken": "your-api-token"
}
```

## Cross-Agent Recall

An agent can recall from multiple banks using `recallFrom` in its bank config:

```json5
{
  "recallFrom": ["atlas", "finance", "ops"],
  "recallBudget": "high",
  "recallMaxTokens": 2048
}
```

When access control is active, permissions are checked independently for each target bank. If the user has `recall: false` on a target bank, that bank is skipped entirely.
