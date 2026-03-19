# Bank Configuration

Each agent gets a bank config file — a JSON5 template that defines how Hindsight processes that agent's memories.

## Bank Config File Reference

| Field | Type | Scope | Description |
|-------|------|-------|-------------|
| `retain_mission` | string | Server | Guides fact extraction during retain |
| `observations_mission` | string | Server | Controls observation consolidation |
| `reflect_mission` | string | Server | Prompt for reflect operations |
| `retain_extraction_mode` | string | Server | Extraction strategy (`concise`, `verbose`) |
| `disposition_skepticism` | 1-5 | Server | How skeptical during extraction |
| `disposition_literalism` | 1-5 | Server | How literally statements are interpreted |
| `disposition_empathy` | 1-5 | Server | Weight given to emotional content |
| `entity_labels` | EntityLabel[] | Server | Custom entity types for classification |
| `directives` | `{name,content}[]` | Server | Standing instructions for the bank |
| `retain_strategies` | Record | Server | Named extraction strategies |
| `retain_default_strategy` | string | Server | Fallback strategy when no named strategy is passed |
| `retain_chunk_size` | number | Server | Text chunk size for processing |
| `retain` | RetainRouting | Routing | Topic-based strategy routing (plugin-side) |
| `retainTags` | string[] | Tags | Tags added to all retained facts |
| `retainContext` | string | Tags | Source label for retained facts |
| `recallFrom` | string[] | Multi-bank | Banks to query (parallel recall) |
| `sessionStartModels` | config[] | Session | Mental models loaded at session start |
| `reflectOnRecall` | boolean | Reflect | Use reflect instead of recall |
| `reflectBudget` | `low\|mid\|high` | Reflect | Reflect effort level |

Server-side fields are synced to Hindsight via `hindclaw apply`. Routing and behavioral fields are used by the plugin at runtime.

## Example Bank Config

```json5
// .openclaw/banks/atlas.json5
{
  // Server-side — synced to Hindsight
  "retain_mission": "Extract strategic decisions, cross-departmental patterns.",
  "reflect_mission": "You are the strategic advisor. Challenge assumptions.",
  "disposition_skepticism": 4,
  "disposition_literalism": 2,
  "disposition_empathy": 3,
  "entity_labels": { "$include": "./atlas/entity-labels.json5" },
  "directives": [
    { "name": "cross_dept_honesty", "content": "Flag contradictions between departments explicitly." }
  ],

  // Named strategies — different extraction rules per context
  "retain_strategies": {
    "deep-analysis": { "$include": "./atlas/deep-analysis.json5" },
    "lightweight":   { "$include": "./atlas/lightweight.json5" }
  },

  // Strategy routing — which topics use which strategies
  "retain": {
    "strategies": {
      "deep-analysis": { "topics": ["280304"] },
      "lightweight":   { "topics": ["280418"] }
    }
  },

  // Multi-bank recall
  "recallFrom": ["atlas", "finance", "ops"],
  "recallBudget": "high",
  "recallMaxTokens": 2048
}
```

## Named Retain Strategies

Route memory behavior per conversation context. Each Telegram topic can use a different retain strategy with its own extraction rules.

```json5
{
  "retain_strategies": {
    "deep-analysis": {
      "retain_extraction_mode": "verbose",
      "retain_mission": "Extract every decision, risk, and opportunity in full detail."
    },
    "lightweight": {
      "retain_extraction_mode": "concise",
      "retain_mission": "Only keep hard facts — dates, numbers, action items."
    }
  },
  "retain": {
    "strategies": {
      "deep-analysis": { "topics": ["12345"] },
      "lightweight":   { "topics": ["67890"] }
    }
  }
}
```

### Example Scenarios

**Strategic advisor** — one agent, three conversation contexts:

| Topic | Strategy | What happens |
|-------|----------|--------------|
| "Strategy" | `deep-analysis` | Every decision, risk, and opportunity extracted with verbose detail |
| "Daily updates" | `lightweight` | Only hard facts — dates, numbers, action items |
| "Weekly review" | *(no strategy)* | Recall only, review conversation not retained |

**Health agent** with data boundaries:

| Topic | Strategy | What happens |
|-------|----------|--------------|
| "Fitness log" | `training` | Extracts sets, reps, PRs, recovery scores |
| "Medical" | *(disabled)* | No memory interaction — strict boundary |
| "Sleep" | `wellness` | Tracks sleep patterns, recovery scores |

## `$include` Directives

Split large configs into manageable files. Resolved recursively, relative to the containing file:

```json5
// Main bank config
{
  "entity_labels": { "$include": "./atlas/labels.json5" },
  "retain_strategies": {
    "detailed": { "$include": "./atlas/detailed-strategy.json5" }
  }
}
```

```
.openclaw/banks/
├── atlas.json5                    <- main bank config
├── atlas/
│   ├── labels.json5               <- entity label definitions
│   ├── detailed-strategy.json5    <- strategy: verbose + custom labels
│   └── quick-strategy.json5       <- strategy: concise extraction
```

Limits: max depth 10, circular reference detection, paths relative to containing file.
