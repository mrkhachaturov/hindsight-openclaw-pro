---
sidebar_position: 3
title: Bank Config Fields
---

# Bank Config Field Reference

Each agent has a bank config file (JSON5) that defines how Hindsight processes that agent's memories. Fields are divided by scope: **server-side** fields are synced to the Hindsight API via `hindclaw apply`, while **behavioral** and **routing** fields are used by the plugin at runtime and never leave the gateway.

**Naming convention:** `snake_case` fields are server-side. `camelCase` fields are behavioral or routing.

## All Fields

| Field | Type | Scope | Description |
|-------|------|-------|-------------|
| `retain_mission` | `string` | Server | Guides fact extraction during retain. Tells the LLM what to look for in conversations. |
| `observations_mission` | `string` | Server | Controls how observations are consolidated from retained facts. |
| `reflect_mission` | `string` | Server | System prompt used during reflect operations. Defines the agent's analytical persona. |
| `retain_extraction_mode` | `string` | Server | Extraction verbosity. Values: `concise`, `verbose`. |
| `disposition_skepticism` | `number` (1--5) | Server | How skeptical the extraction LLM is. `1` = accepts everything, `5` = demands evidence. |
| `disposition_literalism` | `number` (1--5) | Server | How literally statements are interpreted. `1` = reads between the lines, `5` = takes everything at face value. |
| `disposition_empathy` | `number` (1--5) | Server | Weight given to emotional content. `1` = ignores feelings, `5` = captures emotional nuance. |
| `entity_labels` | `EntityLabel[]` | Server | Custom entity types for classifying extracted facts. See [Entity Labels](#entity-labels) below. |
| `directives` | `Directive[]` | Server | Standing instructions for the bank. See [Directives](#directives) below. |
| `retain_strategies` | `Record<string, object>` | Server | Named extraction strategy definitions. See [Retain Strategies](#retain-strategies) below. |
| `retain_default_strategy` | `string` | Server | Name of the fallback strategy used when no named strategy is matched by routing. |
| `retain_chunk_size` | `number` | Server | Text chunk size (in characters) for processing during retention. |
| `retainTags` | `string[]` | Tags | Tags automatically added to all facts retained by this agent. |
| `retainContext` | `string` | Tags | Source label attached to retained facts (e.g., `"telegram-yoda"`). |
| `retainObservationScopes` | `string \| string[][]` | Tags | Observation scopes for retained facts. A string applies a single scope; nested arrays define compound scopes. |
| `recallTags` | `string[]` | Tags | Only recall facts that have these tags. |
| `recallTagsMatch` | `string` | Tags | Tag matching mode for `recallTags`. Values: `any`, `all`, `any_strict`, `all_strict`. |
| `retain` | `RetainRouting` | Routing | Topic-based strategy routing. Maps Telegram topic IDs to named strategies. See [Strategy Routing](#strategy-routing) below. |
| `recallFrom` | `RecallFromEntry[]` | Multi-bank | Banks to query in parallel during recall. See [Cross-Agent Recall](/docs/reference/configuration#cross-agent-recall). |
| `sessionStartModels` | `SessionStartModelConfig[]` | Session | Mental models and recall queries loaded at session start. See [Session Start Models](#session-start-models) below. |
| `reflectOnRecall` | `boolean` | Reflect | Use the reflect API instead of recall. Reflect synthesizes an answer from memories rather than returning raw results. |
| `reflectBudget` | `string` | Reflect | Effort level for reflect. Values: `low`, `mid`, `high`. |
| `reflectMaxTokens` | `number` | Reflect | Maximum tokens for reflect responses. |
| `hindsightApiUrl` | `string` | Infrastructure | Override the Hindsight API URL for this agent. Connects this agent to a different server. |
| `hindsightApiToken` | `string` | Infrastructure | Bearer token for this agent's Hindsight server. |
| `autoRecall` | `boolean` | Behavioral | Override the plugin default for automatic recall. |
| `autoRetain` | `boolean` | Behavioral | Override the plugin default for automatic retention. |
| `recallBudget` | `string` | Behavioral | Override recall effort. Values: `low`, `mid`, `high`. |
| `recallMaxTokens` | `number` | Behavioral | Override max tokens injected per recall. |
| `recallTypes` | `string[]` | Behavioral | Override memory types to recall. Values: `world`, `experience`, `observation`. |
| `recallRoles` | `string[]` | Behavioral | Roles included in the recall query context. Values: `user`, `assistant`, `system`, `tool`. |
| `recallTopK` | `number` | Behavioral | Maximum number of memory results returned. |
| `recallContextTurns` | `number` | Behavioral | Number of recent turns used as recall query context. |
| `recallMaxQueryChars` | `number` | Behavioral | Maximum character length of the recall query. |
| `recallPromptPreamble` | `string` | Behavioral | Text prepended to the recalled memories block. |
| `retainRoles` | `string[]` | Behavioral | Override which message roles are retained. Values: `user`, `assistant`, `system`, `tool`. |
| `retainEveryNTurns` | `number` | Behavioral | Retain every Nth turn. |
| `retainOverlapTurns` | `number` | Behavioral | Overlap turns between consecutive retain windows. |
| `excludeProviders` | `string[]` | Behavioral | Skip memory operations for these message providers. |
| `dynamicBankId` | `boolean` | Behavioral | Override dynamic bank ID derivation. |
| `dynamicBankGranularity` | `string[]` | Behavioral | Override bank ID derivation fields. Values: `agent`, `provider`, `channel`, `user`. |
| `bankIdPrefix` | `string` | Behavioral | Override the bank ID prefix. |
| `llmProvider` | `string` | Behavioral | Override LLM provider for extraction. |
| `llmModel` | `string` | Behavioral | Override LLM model for extraction. |
| `llmApiKeyEnv` | `string` | Behavioral | Environment variable name for the LLM API key. |
| `debug` | `boolean` | Behavioral | Enable debug logging for this agent. |

---

## Entity Labels

Entity labels define custom classification dimensions for extracted facts. Each label creates a tagging axis that the extraction LLM applies to every retained memory.

### Schema: `EntityLabel`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | yes | Unique identifier for this label (used as the tag prefix). |
| `description` | `string` | yes | Tells the extraction LLM what this label represents. |
| `type` | `string` | yes | Value type. `value` = single selection, `multi-values` = multiple selections, `text` = free-form text. |
| `tag` | `boolean` | no | When `true`, the selected values are added as tags on the retained fact. Enables tag-based filtering during recall. |
| `optional` | `boolean` | no | When `true`, the LLM may skip this label if it does not apply. |
| `values` | `EntityLabelValue[]` | conditional | Required when `type` is `value` or `multi-values`. Defines the allowed values. |

### Schema: `EntityLabelValue`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `value` | `string` | yes | The value string (used in tags and filtering). |
| `description` | `string` | yes | Tells the extraction LLM when to select this value. |

### Example

```json5
[
  {
    "key": "department",
    "description": "Which AstraTeam department this fact relates to",
    "type": "multi-values",
    "tag": true,
    "values": [
      { "value": "motors",  "description": "AstroMotors -- car service and repair" },
      { "value": "detail",  "description": "AstroDetail -- detailing and car care" },
      { "value": "estate",  "description": "AstraEstate -- commercial real estate" },
      { "value": "group",   "description": "AstraTeam group level, cross-departmental" }
    ]
  },
  {
    "key": "decision_type",
    "description": "Type of strategic matter",
    "type": "multi-values",
    "tag": true,
    "values": [
      { "value": "strategy",    "description": "Business direction, long-term plans" },
      { "value": "risk",        "description": "Risks, concerns, potential problems" },
      { "value": "opportunity", "description": "Growth opportunities, new initiatives" },
      { "value": "decision",    "description": "Concrete decision made by leadership" }
    ]
  }
]
```

---

## Directives

Directives are standing instructions stored on the Hindsight server for a bank. They influence how the extraction LLM processes conversations. Managed declaratively: directives present in the local file are created or updated; directives absent from the local file are deleted from the server.

### Schema: `BankConfigDirective`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Unique name for this directive. Used as the identifier during sync. |
| `content` | `string` | yes | The instruction text. |

### Example

```json5
{
  "directives": [
    {
      "name": "cross_dept_honesty",
      "content": "Flag contradictions between departments explicitly."
    },
    {
      "name": "financial_precision",
      "content": "Always extract exact numbers for revenue, costs, and margins."
    }
  ]
}
```

---

## Retain Strategies

Named retain strategies allow different extraction rules per conversation context. Each strategy is a set of server-side overrides (missions, extraction mode, entity labels, etc.) applied when that strategy is selected.

Strategies are defined in `retain_strategies` and routed to specific topics via the `retain` field.

### Schema: `retain_strategies`

A record where each key is the strategy name and the value is an object containing any server-side bank config overrides.

```json5
{
  "retain_strategies": {
    "<strategy-name>": {
      "retain_extraction_mode": "verbose" | "concise",
      "retain_mission": "...",
      "entity_labels": [...],
      // Any other server-side field overrides
    }
  }
}
```

### Example

```json5
{
  "retain_strategies": {
    "deep-analysis": {
      "retain_extraction_mode": "verbose",
      "retain_mission": "Extract every decision, risk, and opportunity in full detail."
    },
    "lightweight": {
      "retain_extraction_mode": "concise",
      "retain_mission": "Only keep hard facts -- dates, numbers, action items."
    }
  },
  "retain_default_strategy": "lightweight"
}
```

---

## Strategy Routing

The `retain` field maps conversation contexts (Telegram topic IDs) to named strategies. When a message arrives from a matched topic, the corresponding strategy's extraction rules are used instead of the bank defaults.

### Schema: `RetainRouting`

| Field | Type | Description |
|-------|------|-------------|
| `strategies` | `Record<string, MemoryScope>` | Maps strategy names to the topics they handle. |

### Schema: `MemoryScope`

| Field | Type | Description |
|-------|------|-------------|
| `topics` | `string[]` | Telegram topic IDs that use this strategy. |

### Example

```json5
{
  "retain": {
    "strategies": {
      "deep-analysis": { "topics": ["280304"] },
      "lightweight":   { "topics": ["280418", "280500"] }
    }
  }
}
```

Messages from topics not listed in any strategy use the `retain_default_strategy` (if set) or the bank's default extraction configuration.

### Routing Scenarios

**Strategic advisor** -- one agent, three conversation contexts:

| Topic | Strategy | Behavior |
|-------|----------|----------|
| "Strategy" | `deep-analysis` | Every decision, risk, and opportunity extracted with verbose detail. |
| "Daily updates" | `lightweight` | Only hard facts -- dates, numbers, action items. |
| "Weekly review" | *(no strategy)* | Uses bank defaults or `retain_default_strategy`. |

**Health agent** with data boundaries:

| Topic | Strategy | Behavior |
|-------|----------|----------|
| "Fitness log" | `training` | Extracts sets, reps, PRs, recovery scores. |
| "Medical" | *(disabled)* | No memory interaction -- strict boundary. |
| "Sleep" | `wellness` | Tracks sleep patterns and recovery scores. |

---

## Session Start Models

Load mental models or run targeted recall queries when a new session begins. Provides baseline context before any conversation happens.

### Schema: `SessionStartModelConfig`

Two variants:

**Mental model variant:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"mental_model"` | yes | Loads a pre-built mental model from a bank. |
| `bankId` | `string` | yes | Bank containing the mental model. |
| `modelId` | `string` | yes | ID of the mental model to load. |
| `label` | `string` | yes | Display label injected with the model content. |
| `roles` | `string[]` | no | Only load for sessions initiated by these roles. |

**Recall variant:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"recall"` | yes | Runs a recall query at session start. |
| `bankId` | `string` | yes | Bank to recall from. |
| `query` | `string` | yes | The recall query string. |
| `label` | `string` | yes | Display label injected with the results. |
| `maxTokens` | `number` | no | Maximum tokens for this recall. |
| `roles` | `string[]` | no | Only load for sessions initiated by these roles. |

### Example

```json5
{
  "sessionStartModels": [
    {
      "type": "mental_model",
      "bankId": "yoda",
      "modelId": "business-context",
      "label": "Business Context"
    },
    {
      "type": "recall",
      "bankId": "yoda",
      "query": "recent strategic decisions and open action items",
      "label": "Recent Decisions",
      "maxTokens": 512
    }
  ]
}
```

---

## `$include` Directives

Large bank configs can be split into separate files using `$include`. References are resolved recursively, relative to the containing file.

```json5
{
  "entity_labels": { "$include": "./agent-1/labels.json5" },
  "retain_strategies": {
    "detailed": { "$include": "./agent-1/detailed-strategy.json5" }
  }
}
```

Resulting file layout:

```
.openclaw/banks/
  agent-1.json5                  <-- main bank config
  agent-1/
    labels.json5                 <-- entity label definitions
    detailed-strategy.json5      <-- strategy overrides
    quick-strategy.json5         <-- another strategy
```

**Limits:** maximum depth of 10 levels, circular reference detection, paths always relative to the containing file.
