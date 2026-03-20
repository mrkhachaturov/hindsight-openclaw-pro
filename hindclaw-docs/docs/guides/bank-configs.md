---
sidebar_position: 1
title: Bank Configuration
---

# Bank Configuration

Each agent in your fleet gets a bank config file -- a JSON5 template that controls how Hindsight processes that agent's memories. These files live in your banks directory and are synced to the Hindsight server via `hindclaw apply`.

## File structure

Bank configs use JSON5 (comments, trailing commas, unquoted keys allowed). The file name corresponds to the agent ID:

```
.openclaw/banks/
├── yoda.json5
├── yoda/
│   ├── entity-labels.json5
│   └── deep-analysis.json5
├── r2d2.json5
├── c3po.json5
└── ...
```

## Missions

Missions are natural-language instructions that tell Hindsight what to extract and how to reason. There are three types, each controlling a different phase of the memory pipeline.

### retain_mission

Guides fact extraction during the retain phase. This is the most important mission -- it determines what gets stored when conversations are processed.

```json5
{
  "retain_mission": "Extract strategic decisions, cross-departmental patterns, and action items with deadlines. Prioritize information that connects multiple business units."
}
```

### observations_mission

Controls how Hindsight consolidates observations over time. Observations are higher-level patterns that emerge from accumulated facts.

```json5
{
  "observations_mission": "Identify recurring themes across departments. Track evolving priorities and flag contradictions between stated goals and actual decisions."
}
```

### reflect_mission

Sets the prompt used when the agent reflects over its memories instead of retrieving raw facts (see the [reflect guide](./reflect.md)).

```json5
{
  "reflect_mission": "You are the strategic advisor. Reason critically over stored knowledge. Challenge assumptions and surface non-obvious connections."
}
```

## Dispositions

Dispositions are numeric dials (1-5) that tune how the extraction LLM interprets conversations. They affect all memory operations on the bank.

| Disposition | Low (1) | High (5) |
|---|---|---|
| `disposition_skepticism` | Takes statements at face value | Questions claims, looks for contradictions |
| `disposition_literalism` | Reads between the lines, infers intent | Sticks to exactly what was said |
| `disposition_empathy` | Focuses on facts and data | Weighs emotional content and tone |

```json5
{
  // A skeptical, context-aware advisor
  "disposition_skepticism": 4,
  "disposition_literalism": 2,
  "disposition_empathy": 3
}
```

Choose dispositions based on the agent's role. A financial analyst might want high skepticism and literalism. A wellness coach might want low skepticism and high empathy.

## Entity labels

Entity labels define custom classification types for extracted facts. When a fact is extracted, the LLM classifies it according to these labels and attaches the values as structured metadata.

```json5
{
  "entity_labels": [
    {
      "key": "department",
      "description": "Which business department this relates to",
      "type": "multi-values",
      "tag": true,
      "values": [
        {"value": "motors", "description": "AstroMotors car service"},
        {"value": "detail", "description": "AstroDetail detailing"},
        {"value": "estate", "description": "AstraEstate real estate"}
      ]
    },
    {
      "key": "sensitivity",
      "description": "Information sensitivity level",
      "type": "value",
      "tag": true,
      "values": [
        {"value": "public", "description": "Safe to share broadly"},
        {"value": "internal", "description": "Internal use only"},
        {"value": "restricted", "description": "Limited access"}
      ]
    },
    {
      "key": "summary",
      "description": "Brief summary of the fact",
      "type": "text",
      "optional": true
    }
  ]
}
```

The `tag: true` flag is important -- it means the label's values are added as tags on each fact, which enables tag-based filtering during recall. A label with `"tag": true` and values like `"motors"` and `"estate"` produces tags like `department:motors` and `department:estate` on the extracted facts. These tags can then be used with `recallTagGroups` in access control to filter what different users see.

Label types:
- **`value`** -- single value from a predefined list
- **`multi-values`** -- one or more values from a predefined list
- **`text`** -- free-form text (not used for tagging)

## Directives

Directives are standing instructions for the bank -- persistent rules that apply to all memory operations. Unlike missions (which guide extraction), directives add behavioral constraints.

```json5
{
  "directives": [
    {
      "name": "cross_dept_honesty",
      "content": "Flag contradictions between departments explicitly. Do not smooth over inconsistencies."
    },
    {
      "name": "financial_precision",
      "content": "Always extract exact numbers for financial figures. Never round or approximate."
    }
  ]
}
```

Directives are managed via IaC -- `hindclaw apply` creates, updates, and deletes directives to match the config file. A directive removed from the file gets deleted from the server.

## Named retain strategies

Strategies let you route different conversation topics to different extraction behaviors. Each strategy defines its own retain mission, extraction mode, and optionally its own entity labels.

### Defining strategies

Strategies are defined in `retain_strategies` (server-side, synced via `hindclaw apply`) and routed in `retain` (plugin-side, used at runtime):

```json5
{
  // Server-side: what each strategy does
  "retain_strategies": {
    "deep-analysis": {
      "retain_extraction_mode": "verbose",
      "retain_mission": "Extract every decision, risk, and opportunity in full detail. Include reasoning and context."
    },
    "lightweight": {
      "retain_extraction_mode": "concise",
      "retain_mission": "Only keep hard facts -- dates, numbers, action items. Skip discussion and reasoning."
    }
  },

  // Plugin-side: which topics use which strategy
  "retain": {
    "strategies": {
      "deep-analysis": { "topics": ["280304"] },
      "lightweight":   { "topics": ["280418"] }
    }
  }
}
```

Topics are Telegram topic IDs (or any string identifier from your messaging platform). When a message arrives in a mapped topic, the corresponding strategy name is passed to Hindsight during retention.

Messages in unmapped topics use the bank's default extraction settings.

### Strategy modes

The routing determines the mode automatically:

| Mapped to strategy? | Mode | Recall | Retain |
|---|---|---|---|
| Yes | `full` | Yes | Yes, using the named strategy |
| No (unmapped topic) | `full` | Yes | Yes, using bank defaults |

When access control is active, mode resolution is handled by permissions instead of topic mapping. See the [access control guide](./access-control.md).

## Using $include for modular configs

Large bank configs can be split into separate files using `$include` directives. This keeps configs readable and lets you reuse fragments across agents.

```json5
// .openclaw/banks/yoda.json5
{
  "retain_mission": "Extract strategic decisions and cross-departmental patterns.",
  "entity_labels": { "$include": "./yoda/entity-labels.json5" },
  "retain_strategies": {
    "deep-analysis": { "$include": "./yoda/deep-analysis.json5" },
    "lightweight":   { "$include": "./yoda/lightweight.json5" }
  },
  "directives": { "$include": "./yoda/directives.json5" }
}
```

```json5
// .openclaw/banks/yoda/entity-labels.json5
[
  {
    "key": "department",
    "description": "Which AstraTeam department",
    "type": "multi-values",
    "tag": true,
    "values": [
      {"value": "motors", "description": "AstroMotors"},
      {"value": "detail", "description": "AstroDetail"},
      {"value": "estate", "description": "AstraEstate"}
    ]
  }
]
```

Include resolution rules:
- Paths are relative to the file containing the `$include`
- Max nesting depth: 10 levels
- Circular references are detected and rejected
- The included file replaces the `$include` object entirely

## Full example

A complete bank config for a strategic advisor agent:

```json5
// .openclaw/banks/yoda.json5
{
  // How to extract facts
  "retain_mission": "Extract strategic decisions, priorities, risks, and cross-departmental patterns. Track evolving goals.",
  "observations_mission": "Identify recurring themes. Flag contradictions between departments.",
  "reflect_mission": "You are the strategic advisor. Challenge assumptions and surface connections.",
  "retain_extraction_mode": "verbose",

  // Extraction tuning
  "disposition_skepticism": 4,
  "disposition_literalism": 2,
  "disposition_empathy": 3,

  // Classification
  "entity_labels": { "$include": "./yoda/entity-labels.json5" },

  // Standing rules
  "directives": [
    { "name": "cross_dept", "content": "Flag contradictions between departments explicitly." }
  ],

  // Per-topic extraction
  "retain_strategies": {
    "deep-analysis": { "$include": "./yoda/deep-analysis.json5" },
    "lightweight":   { "$include": "./yoda/lightweight.json5" }
  },
  "retain": {
    "strategies": {
      "deep-analysis": { "topics": ["280304"] },
      "lightweight":   { "topics": ["280418"] }
    }
  },

  // Read from multiple agents
  "recallFrom": [
    { "bankId": "yoda" },
    { "bankId": "k2so", "budget": "low" },
    { "bankId": "c3po", "budget": "low", "maxTokens": 512 }
  ],
  "recallBudget": "high",
  "recallMaxTokens": 2048
}
```

## Syncing to the server

Bank configs are source of truth. Use the CLI to sync them:

```bash
# Preview what will change
hindclaw plan --agent yoda

# Apply changes (with confirmation)
hindclaw apply --agent yoda

# Apply all agents at once
hindclaw apply --all

# Pull current server state into a file
hindclaw import --agent yoda --output ./banks/yoda.json5
```

Fields in the config file are split into two categories by naming convention:
- **snake_case** fields (`retain_mission`, `entity_labels`, `retain_strategies`) are server-side -- synced via `hindclaw apply`
- **camelCase** fields (`recallFrom`, `recallBudget`, `sessionStartModels`) are behavioral -- used by the plugin at runtime, not synced
