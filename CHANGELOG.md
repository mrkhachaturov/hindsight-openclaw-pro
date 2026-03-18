# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-alpha.2] - 2026-03-18

### Fixed
- Bank config paths now resolve relative to OpenClaw state dir (`OPENCLAW_STATE_DIR` → `OPENCLAW_CONFIG_PATH` dirname → `~/.openclaw/`)
- Plugin config reads from `hindsight-openclaw-pro` entry (was reading old `hindsight-openclaw` name)
- Skip duplicate daemon start when gateway loads plugin multiple times during startup/hot-reload
- Inject `claude-agent-sdk` into uvx when using `claude-code` LLM provider

## [1.0.0-alpha.1] - 2026-03-18

### Added
- Per-agent bank config templates — declarative JSON5 files for missions, entity labels, directives, dispositions
- Two-level config resolution: plugin defaults → bank config file (shallow merge)
- Per-agent infrastructure overrides — different agents can connect to different Hindsight servers
- Full stateless Hindsight HTTP client — bankId per-call, no instance state
  - Retain with tags, context, observation_scopes (items[] batch format)
  - Recall with tag_groups (forward-compatible with v2 access control)
  - Reflect for disposition-aware reasoning
  - Bank config CRUD (get/update/reset)
  - Directives CRUD (list/create/update/delete)
  - Mental models (get/list)
  - Tags listing
- Multi-bank recall — `recallFrom` field for parallel recall from multiple banks (Yoda pattern)
- Session start hook — load mental models at session start, inject as `<hindsight_context>`
- Reflect on recall — use Hindsight reflect API instead of raw recall per agent
- Bootstrap — first-run auto-apply of bank config to empty banks
- `hoppro` CLI with Terraform-style commands:
  - `hoppro plan` — diff local config files against Hindsight server state
  - `hoppro apply` — apply changes (config fields + directives CRUD)
  - `hoppro import` — pull server state into local file
- Extracted hooks into separate modules (recall, retain, session-start)
- Plugin manifest with new schema fields (bootstrap, agents, retainTags, recallTags, etc.)

### Changed
- Rewritten from `@vectorize-io/hindsight-openclaw` (upstream reference, not a patch)
- Plugin ID: `hindsight-openclaw-pro` (was `hindsight-openclaw`)
- `index.ts` reduced from 1389 lines to ~600 lines (hooks extracted)
- Client is stateless per-call (removed `clientsByBankId` map, `setBankId`, `setBankMission`)
- Retain uses native `items[]` batch format (not flat content wrapper)

### Removed
- `bankMission` as primary bank config mechanism (replaced by bank config files + bootstrap)
- Instance-level bank state in client
