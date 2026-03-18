# hindsight-openclaw-pro

Production-grade [Hindsight](https://vectorize.io/hindsight) memory plugin for [OpenClaw](https://openclaw.ai) — per-agent config files, multi-bank recall, IaC-style bank management, and a `hoppro` CLI for plan/apply/import workflows.

Extends the upstream `@vectorize-io/hindsight-openclaw` with:

- **Per-agent bank config files** — declarative YAML/JSON5 per agent, checked into source control
- **IaC sync** — `hoppro plan` diffs local config against server state, `hoppro apply` converges
- **Multi-bank recall** — `recallFrom` lets an agent pull from multiple banks per turn
- **Bootstrap** — first-run auto-apply of bank config on empty banks
- **Reflect** — structured memory summarisation via the Hindsight reflect API

## Installation

```bash
openclaw plugins install hindsight-openclaw-pro
```

Or from a local checkout:

```bash
openclaw plugins install /path/to/hindsight-openclaw-pro
```

## Quick Start

### 1. Enable the plugin

Add to your `openclaw.json`:

```json5
{
  "plugins": {
    "entries": {
      "hindsight-openclaw-pro": {
        "enabled": true,
        "config": {
          "hindsightApiUrl": "http://localhost:8888",
          "hindsightApiToken": "your-token"
        }
      }
    }
  }
}
```

### 2. Add a bank config for an agent (optional)

Create `.openclaw/workspace-yoda/hindsight.json5`:

```json5
{
  "retain_mission": "Yoda is a strategic AI mentor. Capture decisions, lessons, and user goals.",
  "disposition_skepticism": 4,
  "disposition_literalism": 2,
  "disposition_empathy": 5,
  "directives": [
    {
      "name": "focus-on-patterns",
      "content": "Prioritise recurring themes and long-term patterns over one-off events."
    }
  ]
}
```

Point the plugin to it in your agent config:

```json5
{
  "plugins": {
    "entries": {
      "hindsight-openclaw-pro": {
        "config": {
          "agents": {
            "yoda": { "bankConfig": ".openclaw/workspace-yoda/hindsight.json5" }
          }
        }
      }
    }
  }
}
```

### 3. Apply the config to the server

```bash
hoppro plan   # preview changes
hoppro apply  # apply them
```

### 4. Start OpenClaw

```bash
openclaw gateway
```

Memory capture and recall are now automatic on every turn.

## Configuration Reference

### Plugin config

Options under `plugins.entries.hindsight-openclaw-pro.config`:

| Option | Default | Description |
|--------|---------|-------------|
| `hindsightApiUrl` | — | Hindsight API URL (required for HTTP mode) |
| `hindsightApiToken` | — | Bearer token for the Hindsight API |
| `apiPort` | `9077` | Port for the local Hindsight daemon (embed mode) |
| `embedVersion` | `"latest"` | `hindsight-embed` version (embed mode) |
| `embedPackagePath` | — | Path to a local `hindsight-embed` checkout (development) |
| `daemonIdleTimeout` | `0` | Seconds of inactivity before daemon shuts down (0 = never) |
| `dynamicBankId` | `true` | Derive bank ID from context (agent, channel, user) |
| `dynamicBankGranularity` | `["agent","channel","user"]` | Fields used to build the bank ID |
| `bankIdPrefix` | — | Prefix prepended to derived bank IDs |
| `autoRecall` | `true` | Inject recalled memories before each turn |
| `autoRetain` | `true` | Retain conversations after each turn |
| `recallBudget` | `"mid"` | Recall effort: `low`, `mid`, or `high` |
| `recallMaxTokens` | `1024` | Max tokens injected per turn from recall |
| `recallTypes` | `["world","experience"]` | Memory types to recall |
| `recallRoles` | `["user","assistant"]` | Roles included when composing the recall query |
| `recallTopK` | — | Hard cap on memories injected per turn |
| `recallContextTurns` | `1` | Number of prior user turns used to compose recall query |
| `recallMaxQueryChars` | `800` | Max characters in the recall query |
| `recallPromptPreamble` | built-in | Text placed above recalled memories in the system context block |
| `retainRoles` | `["user","assistant"]` | Message roles captured for retention |
| `retainEveryNTurns` | `1` | Retain every Nth turn (sliding-window chunking when > 1) |
| `retainOverlapTurns` | `0` | Extra prior turns included in each retention chunk |
| `excludeProviders` | `[]` | Message providers to skip entirely (e.g. `telegram`) |
| `agents` | `{}` | Per-agent overrides — `{ "agent-id": { bankConfig: "path/to/hindsight.json5" } }` |
| `bootstrap` | — | Directory of `<agent-id>.json5` bank config files (alternative to per-agent `agents` map) |
| `llmProvider` | auto | LLM provider for memory extraction (`openai`, `anthropic`, `gemini`, `groq`, `ollama`, `openai-codex`, `claude-code`) |
| `llmModel` | provider default | Model name used with `llmProvider` |
| `llmApiKeyEnv` | provider standard | Custom env var name for the provider API key |

### Bank config file

Per-agent config file (JSON5 or JSON). Fields map directly to Hindsight bank settings:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `retain_mission` | string | Agent identity / purpose — guides fact extraction |
| `observations_mission` | string | Overrides extraction prompt for observation-type memories |
| `reflect_mission` | string | Prompt used during reflect operations |
| `retain_extraction_mode` | string | Extraction strategy (see Hindsight docs) |
| `disposition_skepticism` | 1–5 | How skeptical the engine is when extracting facts |
| `disposition_literalism` | 1–5 | How literally the engine interprets statements |
| `disposition_empathy` | 1–5 | Weight given to emotional / relational content |
| `entity_labels` | EntityLabel[] | Custom entity types for this bank |
| `directives` | `{ name, content }[]` | Standing instructions the model follows during recall |
| `recallFrom` | RecallFromEntry[] | Additional banks to pull from each turn |
| `retainTags` | string[] | Tags attached to all retained memories |
| `recallTags` | string[] | Filter recalled memories to these tags |
| `recallTagsMatch` | `"any"` \| `"all"` | Tag filter mode |

All plugin-level behavioral options (`autoRecall`, `recallBudget`, etc.) can also be overridden per-agent in the bank config file.

## CLI: hoppro

```text
hoppro plan   [--agent <id>]   # diff local bank configs against server state
hoppro apply  [--agent <id>]   # apply changes shown by plan
hoppro import [--agent <id>]   # pull current server state back to local file
```

Options:

- `--agent <id>` — operate on a single agent (default: all configured agents)
- `--config <path>` — path to `openclaw.json` (default: auto-detected)
- `--dry-run` — print what would change without writing (apply only)

## Migration from @vectorize-io/hindsight-openclaw

1. Remove `@vectorize-io/hindsight-openclaw` from your OpenClaw plugin list.
2. Install `hindsight-openclaw-pro` (above).
3. Move any `bankMission` value from your plugin config into a bank config file as `retain_mission`.
4. All other plugin-level options use the same names — copy them across as-is.

The bank ID scheme is compatible: existing memories are preserved.

## Development

```bash
npm install
npm run build          # compile TypeScript → dist/
npm test               # unit tests (164 tests)
npm run test:integration  # integration tests (requires running Hindsight API)
```

Integration tests read `HINDSIGHT_API_URL` (default `http://localhost:8888`) and `HINDSIGHT_API_TOKEN`.

To work against a local `hindsight-embed` checkout, set `embedPackagePath` in your plugin config.

## Links

- [Hindsight Documentation](https://vectorize.io/hindsight)
- [OpenClaw Documentation](https://openclaw.ai)

## License

MIT
