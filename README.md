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

The official Hindsight plugin gives you auto-capture and auto-recall. HindClaw adds what you need to run it in production — two orthogonal dimensions that combine per-message:

**WHO** (permissions) — resolved through 4 layers, each can override any field:
- Global config defaults → group merge → bank group override → bank user override
- Not just `recall: true/false` — LLM model, token budget, extraction depth, tag visibility, retention frequency. 11 configurable fields at every layer.

**HOW** (strategies) — resolved per topic:
- Each conversation topic routes to a named strategy with its own extraction mission, mode, and entity labels
- Strategies are orthogonal to permissions — a blocked user never reaches strategy resolution

```mermaid
graph LR
    MSG["💬 Message"] --> WHO{"🔐 WHO?"}
    WHO --> PERM["👥 Permission resolution<br/>group → bank → user"]
    PERM --> ACCESS{Access?}
    ACCESS -->|blocked| STOP["🚫 No memory"]
    ACCESS -->|allowed| HOW{"🎯 HOW?"}
    HOW --> STRATEGY["📝 Strategy resolution<br/>topic → named strategy"]
    STRATEGY --> RECALL["📥 Recall with filters"]
    STRATEGY --> RETAIN["📤 Retain with strategy"]

    style MSG fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style PERM fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style STOP fill:#ef4444,color:#fff,stroke:#ef4444
    style STRATEGY fill:#c2410c,color:#fff,stroke:#c2410c
    style RECALL fill:#10b981,color:#fff,stroke:#10b981
    style RETAIN fill:#10b981,color:#fff,stroke:#10b981
```

---

### 🔐 Per-User Access & Behavioral Overrides

The same user gets different behavior on different agents. Every parameter is configurable per group, overridable per bank and per user.

```mermaid
graph TD
    MSG["💬 Message"] --> ID["🔍 Resolve identity"]
    ID --> GROUPS["👥 Merge group permissions"]
    GROUPS --> BANK{"🏦 Bank overrides?"}
    BANK -->|group override| BG["⚙️ Bank group permissions"]
    BANK -->|user override| BU["👤 Bank user permissions"]
    BANK -->|none| GLOBAL["📋 Global defaults"]
    BG --> RESOLVED["✅ Resolved permissions"]
    BU --> RESOLVED
    GLOBAL --> RESOLVED
    RESOLVED --> TOPIC{"🎯 Topic?"}
    TOPIC -->|mapped| STRATEGY["📝 Named strategy"]
    TOPIC -->|unmapped| DEFAULT["📝 Bank defaults"]

    style MSG fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style ID fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style GROUPS fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style BG fill:#c2410c,color:#fff,stroke:#c2410c
    style BU fill:#c2410c,color:#fff,stroke:#c2410c
    style GLOBAL fill:#c2410c,color:#fff,stroke:#c2410c
    style RESOLVED fill:#0f766e,color:#fff,stroke:#0f766e
    style STRATEGY fill:#10b981,color:#fff,stroke:#10b981
    style DEFAULT fill:#f59e0b,color:#fff,stroke:#f59e0b
```

**Override chain** (most specific wins):

```
config.json5 defaults → group → bank group → bank user
```

**Configurable at every level:** `recall`, `retain`, `retainRoles`, `retainTags`, `retainEveryNTurns`, `recallBudget`, `recallMaxTokens`, `recallTagGroups`, `llmModel`, `llmProvider`, `excludeProviders`

**Same user, different agents:**

| | agent-1 (strategic) | agent-2 (financial) |
|---|---|---|
| **user-1** (executive) | recall + retain, high budget, no filters | recall + retain, high budget, no filters |
| **user-2** (dept-head) | recall only, mid budget, filtered | recall + retain, high budget (user override) |
| **user-3** (staff) | blocked (no entry → `_default`) | recall only, low budget, filtered |
| **anonymous** | blocked | blocked |
```

### 🔀 Cross-Agent Recall

One agent queries multiple banks in parallel. Permissions checked per-bank.

```mermaid
graph LR
    Q["🔍 agent-1 recall query"] --> B1["🏦 bank: agent-1"]
    Q --> B2["🏦 bank: agent-2"]
    Q --> B3["🏦 bank: agent-3"]
    B1 -->|recall: true| R1["📥 results"]
    B2 -->|recall: true| R2["📥 results"]
    B3 -->|recall: false| SKIP["🚫 skipped"]
    R1 --> MERGE["🔀 Merge + interleave"]
    R2 --> MERGE
    MERGE --> INJECT["💉 Inject into prompt"]

    style Q fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style B1 fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style B2 fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style B3 fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style R1 fill:#10b981,color:#fff,stroke:#10b981
    style R2 fill:#10b981,color:#fff,stroke:#10b981
    style SKIP fill:#ef4444,color:#fff,stroke:#ef4444
    style MERGE fill:#0f766e,color:#fff,stroke:#0f766e
    style INJECT fill:#0f766e,color:#fff,stroke:#0f766e
```

### 🎯 Named Retain Strategies

Different conversation topics routed to different extraction strategies.

```mermaid
graph LR
    MSG["💬 Incoming message"] --> TOPIC{"🎯 Topic ID?"}
    TOPIC -->|280304| DEEP["🔬 deep-analysis"]
    TOPIC -->|280418| LIGHT["⚡ lightweight"]
    TOPIC -->|other| DEFAULT["📋 bank default"]
    DEEP --> RETAIN1["📝 Verbose extraction"]
    LIGHT --> RETAIN2["📝 Concise extraction"]
    DEFAULT --> RETAIN3["📝 Standard extraction"]

    style MSG fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style DEEP fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style LIGHT fill:#f59e0b,color:#fff,stroke:#f59e0b
    style DEFAULT fill:#c2410c,color:#fff,stroke:#c2410c
    style RETAIN1 fill:#10b981,color:#fff,stroke:#10b981
    style RETAIN2 fill:#10b981,color:#fff,stroke:#10b981
    style RETAIN3 fill:#10b981,color:#fff,stroke:#10b981
```

### 🏗️ Infrastructure as Code

`hindclaw plan` shows what will change. `hindclaw apply` syncs it. Like Terraform for memory banks.

```mermaid
graph LR
    FILE["📂 Bank config files"] --> PLAN["📋 hindclaw plan"]
    PLAN --> DIFF{"🔍 Changes?"}
    DIFF -->|none| OK["✅ Up to date"]
    DIFF -->|yes| SHOW["📄 Show diff"]
    SHOW --> APPLY["⚡ hindclaw apply"]
    APPLY --> CONFIRM{"❓ Confirm?"}
    CONFIRM -->|yes| SYNC["🚀 Sync to Hindsight"]
    CONFIRM -->|no| CANCEL["❌ Cancelled"]

    style FILE fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style PLAN fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style APPLY fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style OK fill:#10b981,color:#fff,stroke:#10b981
    style SHOW fill:#f59e0b,color:#fff,stroke:#f59e0b
    style SYNC fill:#10b981,color:#fff,stroke:#10b981
    style CANCEL fill:#ef4444,color:#fff,stroke:#ef4444
```

### 🧩 Session Start Context

Mental models loaded before the first message — no cold start.

```mermaid
graph LR
    START["🎬 Session starts"] --> LOAD["📦 Load mental models"]
    LOAD --> M1["🧠 Project context"]
    LOAD --> M2["👤 User preferences"]
    M1 --> INJECT["💉 Inject into system prompt"]
    M2 --> INJECT
    INJECT --> READY["✅ Agent ready with full context"]
    READY --> MSG1["💬 First user message"]

    style START fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style LOAD fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style M1 fill:#c2410c,color:#fff,stroke:#c2410c
    style M2 fill:#c2410c,color:#fff,stroke:#c2410c
    style INJECT fill:#0f766e,color:#fff,stroke:#0f766e
    style READY fill:#10b981,color:#fff,stroke:#10b981
    style MSG1 fill:#10b981,color:#fff,stroke:#10b981
```

### 🪞 Reflect on Recall

Instead of raw memory retrieval, the agent reasons over its memories.

```mermaid
graph LR
    Q["💬 User question"] --> MODE{"🪞 Reflect enabled?"}
    MODE -->|yes| REFLECT["🧠 Hindsight reflect API"]
    MODE -->|no| RECALL["📥 Hindsight recall API"]
    REFLECT --> REASON["💡 LLM reasons over memories"]
    REASON --> ANSWER["✅ Grounded response"]
    RECALL --> RAW["📋 Raw memory list"]
    RAW --> ANSWER

    style Q fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style REFLECT fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style RECALL fill:#c2410c,color:#fff,stroke:#c2410c
    style REASON fill:#0f766e,color:#fff,stroke:#0f766e
    style RAW fill:#f59e0b,color:#fff,stroke:#f59e0b
    style ANSWER fill:#10b981,color:#fff,stroke:#10b981
```

### 🌐 Multi-Server Support

Per-agent infrastructure routing — one gateway, multiple Hindsight servers.

```mermaid
graph LR
    GW["🌐 Gateway"] --> A1["🤖 agent-1"]
    GW --> A2["🤖 agent-2"]
    GW --> A3["🤖 agent-3"]
    GW --> A4["🤖 agent-4"]
    A1 --> HOME["🏠 Home server"]
    A2 --> HOME
    A3 --> OFFICE["🏢 Office server"]
    A4 --> LOCAL["💻 Local daemon"]

    style GW fill:#0f766e,color:#fff,stroke:#0f766e
    style A1 fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style A2 fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style A3 fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style A4 fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style HOME fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style OFFICE fill:#c2410c,color:#fff,stroke:#c2410c
    style LOCAL fill:#f59e0b,color:#fff,stroke:#f59e0b
```

### 🚀 Zero-Config Bootstrap

Set `bootstrap: true` and start the gateway. Bank configs applied automatically on first run.

```mermaid
graph LR
    START["🚀 Gateway starts"] --> CHECK{"🏦 Bank empty?"}
    CHECK -->|yes| APPLY["⚙️ Auto-apply config"]
    CHECK -->|no| SKIP["⏭️ Already configured"]
    APPLY --> READY["✅ Bank ready"]
    SKIP --> READY

    style START fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style APPLY fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style SKIP fill:#f59e0b,color:#fff,stroke:#f59e0b
    style READY fill:#10b981,color:#fff,stroke:#10b981
```

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

### 📋 Bank Management

Define agent memory banks as JSON5 files — missions, entity labels, directives, dispositions. All version-controlled.

```bash
hindclaw plan --all     # preview changes
hindclaw apply --all    # sync to Hindsight
hindclaw import --agent agent-1 --output ./banks/agent-1.json5
```

See [CLI Reference](docs/cli.md).

### 🔐 Access & Behavioral Control

Per-user memory behavior — access flags, LLM model, recall budget, token limits, tag visibility, retention depth. All configurable per group, overridable per bank and per user.

```json5
// groups/group-1.json5 — executive role
{
  "displayName": "Executive",
  "members": ["user-1"],
  "recall": true,
  "retain": true,
  "retainRoles": ["user", "assistant", "tool"],
  "retainTags": ["role:executive"],
  "recallBudget": "high",
  "recallMaxTokens": 2048,
  "recallTagGroups": null,  // no filter — sees everything
  "llmModel": "claude-sonnet-4-5-20250929"
}
```

```json5
// groups/group-2.json5 — staff role
{
  "displayName": "Staff",
  "members": ["user-2", "user-3"],
  "recall": true,
  "retain": true,
  "retainRoles": ["assistant"],
  "retainEveryNTurns": 2,
  "recallBudget": "low",
  "recallMaxTokens": 512,
  "recallTagGroups": [
    {"not": {"tags": ["sensitivity:restricted"], "match": "any_strict"}}
  ],
  "llmModel": "gpt-4o-mini"
}
```

See [Access Control](docs/access-control.md).

### 🎯 Named Strategies & Topic Routing

Each conversation topic gets its own memory behavior — different extraction rules, or no memory at all. Strategies are defined server-side with their own mission, extraction mode, and entity labels. Topics route to strategies.

| Mode | Recall | Retain | Use case |
|------|--------|--------|----------|
| `full` | yes | yes (with named strategy) | Strategic conversations — every detail extracted |
| `recall` | yes | no | Read-only — agent reads memory but conversation isn't stored |
| `disabled` | no | no | No memory at all — ephemeral conversations |

```json5
// In bank config
{
  // Server-side strategies (synced via hindclaw apply)
  "retain_strategies": {
    "deep-analysis": { "$include": "./agent-1/deep-analysis.json5" },
    "lightweight":   { "$include": "./agent-1/lightweight.json5" }
  },

  // Topic routing (plugin-side)
  "retain": {
    "strategies": {
      "deep-analysis": { "topics": ["280304"] },  // strategy topic → verbose
      "lightweight":   { "topics": ["280418"] }    // daily topic → concise
    }
  }
}
```

Configs stay modular with `$include` — split entity labels, strategies, and directives into separate files (max depth 10, circular detection).

See [Bank Configuration](docs/bank-config.md).

### 🔀 Cross-Agent Recall

An agent can recall from multiple banks. Permissions are checked per-bank — no unauthorized cross-reads.

```json5
{
  "recallFrom": ["agent-1", "agent-2", "agent-3"],
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
