<p align="center">
  <img src=".github/assets/hindclaw.png" alt="HindClaw">
</p>

<p align="center">
  Production memory for OpenClaw agent fleets — per-user access control, cross-agent recall, and infrastructure-as-code bank management. Powered by Hindsight.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hindclaw"><img src="https://img.shields.io/npm/v/hindclaw?style=flat-square&color=0f766e" alt="npm"></a>
  <img src="https://img.shields.io/badge/license-MIT-10b981?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D22-c2410c?style=flat-square" alt="Node">
</p>

<p align="center">
  <a href="docs/">Documentation</a> &middot;
  <a href="https://hindsight.vectorize.io">Hindsight</a> &middot;
  <a href="https://openclaw.ai">OpenClaw</a>
</p>

---

## Why HindClaw?

Built on [Hindsight](https://hindsight.vectorize.io) — the highest-scoring agent memory system on the [LongMemEval benchmark](https://vectorize.io/#:~:text=The%20New%20Leader%20in%20Agent%20Memory).

The official Hindsight plugin gives you auto-capture and auto-recall. HindClaw adds what you need to run it in production:

- **Per-user access control** — Granular permissions with groups, roles, and bank-level overrides. CEO gets full recall; staff gets filtered views.
- **Cross-agent recall** — Atlas reads from Finance's revenue data and Ops' deployment notes. One query, multiple banks.
- **Named retain strategies** — "deep-analysis" for strategy topics, "lightweight" for daily chat. Routed by conversation topic.
- **Infrastructure as code** — `hindclaw plan` shows what will change. `hindclaw apply` syncs it. Like Terraform for memory banks.

---

## Quick Start

### 1. Install

```bash
openclaw plugins install hindclaw
```

### 2. Configure

Add to your `openclaw.json` (or a `$include`'d config file):

```json5
{
  "plugins": {
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

### 3. Start

```bash
openclaw gateway
```

That's it — memories are captured and recalled automatically.
The plugin starts a local Hindsight daemon on first run (requires Python 3.11+ and `uv`).

> For bank configs, access control, strategies, and multi-server setups, see the [full documentation](docs/).

---

## Features

### Bank Management

Define agent memory banks as JSON5 files — missions, entity labels, directives, dispositions. All version-controlled.

```bash
hindclaw plan --all     # preview changes
hindclaw apply --all    # sync to Hindsight
hindclaw import --agent atlas --output ./banks/atlas.json5
```

See [CLI Reference](docs/cli.md).

### Access Control

Users, groups, and bank-level permission overrides. Tag-based recall filtering with Hindsight's `tag_groups` API (AND/OR/NOT boolean logic).

```json5
// groups/executive.json5
{
  "displayName": "Executive",
  "members": ["alice"],
  "recall": true,
  "retain": true,
  "recallBudget": "high",
  "recallTagGroups": null  // no filter — sees everything
}
```

See [Access Control](docs/access-control.md).

### Named Strategies

Route different conversation topics to different extraction strategies:

```json5
// In bank config
{
  "retain": {
    "strategies": {
      "deep-analysis": { "topics": ["280304"] },
      "lightweight":   { "topics": ["280418"] }
    }
  }
}
```

See [Bank Configuration](docs/bank-config.md).

### Cross-Agent Recall

An agent can recall from multiple banks. Permissions are checked per-bank — no unauthorized cross-reads.

```json5
{
  "recallFrom": ["atlas", "finance", "ops"],
  "recallBudget": "high"
}
```

See [Configuration](docs/configuration.md).

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Configuration](docs/configuration.md) | Plugin config, behavioral defaults, per-agent overrides |
| [Bank Configuration](docs/bank-config.md) | Missions, entity labels, strategies, `$include` directives |
| [Access Control](docs/access-control.md) | Users, groups, permissions, resolution algorithm |
| [CLI Reference](docs/cli.md) | `hindclaw plan`, `apply`, `import`, `init` |
| [Development](docs/development.md) | Building, testing, contributing |

---

## Migration from @vectorize-io/hindsight-openclaw

```bash
openclaw plugins remove @vectorize-io/hindsight-openclaw
openclaw plugins install hindclaw
```

Bank ID scheme is compatible — existing memories are preserved.
All plugin-level options use the same names, including `bankMission`.
Per-agent bank config files use `retain_mission` for the same purpose (server-side field name).

---

## Links

- [Hindsight](https://hindsight.vectorize.io) — the memory engine
- [OpenClaw](https://openclaw.ai) — the agent framework
- [GitHub](https://github.com/mrkhachaturov/hindsight-openclaw-pro)

## License

MIT — see [LICENSE](LICENSE)

Based on [`@vectorize-io/hindsight-openclaw`](https://github.com/vectorize-io/hindsight/tree/main/hindsight-integrations/openclaw) (MIT, Copyright (c) 2025 Vectorize AI, Inc.)
