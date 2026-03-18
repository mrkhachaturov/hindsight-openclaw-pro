# CLAUDE.md — hindsight-openclaw-pro

## Project

Production-grade Hindsight memory plugin for OpenClaw. Replaces the upstream `@vectorize-io/hindsight-openclaw` with per-agent bank config templates, multi-bank recall, session start context, reflect, and IaC-style bank management via `hoppro` CLI.

## Stack

- TypeScript (ESM, `"type": "module"`)
- Node.js 22+
- Vitest for testing
- JSON5 for bank config file parsing
- OpenClaw plugin SDK (`MoltbotPluginAPI`)

## Setup

```bash
npm install
npm run build    # TypeScript → dist/
npm test         # 164 unit tests
```

## Structure

```
src/
├── index.ts              # Plugin entry: init + hook registration (~600 lines)
├── client.ts             # Stateless Hindsight HTTP client (bankId per-call)
├── types.ts              # Full type system (plugin config, bank config, API types)
├── config.ts             # resolveAgentConfig(), bank file parser, file loader
├── moltbot-types.ts      # OpenClaw SDK types (kept from upstream)
├── hooks/
│   ├── recall.ts         # before_prompt_build (single + multi-bank + reflect)
│   ├── retain.ts         # agent_end (tags, context, observation_scopes)
│   └── session-start.ts  # session_start (mental models)
├── sync/
│   ├── plan.ts           # Diff engine: file vs server state → changeset
│   ├── apply.ts          # Execute changeset against Hindsight API
│   ├── import.ts         # Pull server state into local file
│   └── bootstrap.ts      # First-run apply if bank is empty
├── cli/
│   └── index.ts          # hoppro CLI entry point (plan/apply/import)
├── embed-manager.ts      # Local daemon lifecycle (kept from upstream)
├── derive-bank-id.ts     # Bank ID derivation from context
└── format.ts             # Memory formatting for injection
```

## Key Patterns

- **Two-level config**: Plugin config (openclaw.json) has defaults. Bank config files (JSON5) override per-agent. Resolution: shallow merge, bank file wins.
- **Stateless client**: Every client method takes `bankId` as first parameter. No instance-level bank state. Enables multi-bank operations.
- **Server-side vs behavioral**: Bank config fields are split into server-side (applied to Hindsight API via sync) and behavioral (used by hooks at runtime). Field name convention: snake_case = server-side, camelCase = behavioral.
- **Infrastructure as Code**: Bank config files are source of truth. `hoppro plan/apply` manages server state. Directives not in file get deleted.
- **Bootstrap**: One-time apply on first run for empty banks. After that, managed via CLI.
- **Graceful degradation**: All hooks catch errors and log warnings. Never crash the gateway.

## Config Architecture

```
Plugin config (openclaw.json)         Bank config file (banks/*.json5)
├── Daemon (global only)              ├── Server-side (agent-only)
│   apiPort, embedPort, etc.          │   retain_mission, entity_labels, etc.
├── Defaults (overridable)            ├── Infrastructure overrides
│   hindsightApiUrl, recallBudget     │   hindsightApiUrl (different server)
├── bootstrap: true                   ├── Behavioral overrides
└── agents: { id: { bankConfig } }    │   recallBudget, retainTags, etc.
                                      ├── recallFrom (multi-bank)
                                      ├── sessionStartModels
                                      └── reflectOnRecall
```

## Testing

```bash
npm test                        # unit tests (vitest, 164 tests)
npm run test:integration        # integration tests (needs Hindsight API)
```

Integration tests require:
- `HINDSIGHT_API_URL` (default: `http://localhost:8888`)
- `HINDSIGHT_API_TOKEN` (optional)

## Publishing

Push a `v*` tag — GitHub Actions publishes to npm via OIDC trusted publisher.

```bash
# bump version in package.json + CHANGELOG.md, then:
git tag v1.0.0-alpha.1
git push origin main --tags
```

## CLI: hoppro

```bash
hoppro plan --all              # diff local files vs server
hoppro apply --agent r4p17     # apply changes
hoppro import --agent r4p17 --output ./banks/r4p17.json5
```

## Upstream Reference

The original plugin source is at `3rdparty-src/for Memory/hindsight/hindsight-integrations/openclaw/src/`. Kept from upstream: LLM detection, external API detection, health checks, embed manager, derive-bank-id, format-memories. Rewritten: client, types, hooks, config, sync, CLI.

## Design Spec

`docs/specs/2026-03-18-hindsight-astromech-v1-design.md` in the astromech repo.
