# Access Control

Layered permission model: users belong to groups, groups define defaults, banks override per-group or per-user.

## Directory Structure

Access control uses a self-contained directory at `.openclaw/hindsight/`:

```
.openclaw/hindsight/
├── config.json5           <- plugin settings
├── banks/
│   ├── atlas.json5        <- bank config (file name = agent ID)
│   ├── atlas/             <- $include fragments
│   └── ...
├── groups/
│   ├── _default.json5     <- REQUIRED — anonymous/unknown users
│   ├── executive.json5
│   ├── staff.json5
│   └── ...
└── users/
    ├── alice.json5        <- canonical ID = file name
    └── ...
```

Enable by setting `configPath` in your plugin config:

```json5
"hindclaw": {
  "enabled": true,
  "configPath": "./hindsight"
}
```

## Users

A user file defines identity only — who they are across channels. No permissions, no group membership.

```json5
// users/alice.json5
{
  "displayName": "Alice",
  "email": "alice@northwind.com",
  "channels": {
    "telegram": "123456",
    "slack": "U123456"
  }
}
```

## Groups

A group file defines who's in it and what permission defaults they get.

### Role Groups

```json5
// groups/executive.json5
{
  "displayName": "Executive",
  "members": ["alice"],
  "recall": true,
  "retain": true,
  "retainRoles": ["user", "assistant", "tool"],
  "retainTags": ["role:executive"],
  "recallBudget": "high",
  "recallMaxTokens": 2048,
  "recallTagGroups": null,              // no filter — sees everything
  "llmModel": "claude-sonnet-4-5-20250929"
}
```

```json5
// groups/staff.json5
{
  "displayName": "Staff",
  "members": ["charlie"],
  "recall": true,
  "retain": true,
  "retainRoles": ["assistant"],
  "retainTags": ["role:staff"],
  "retainEveryNTurns": 2,
  "recallBudget": "low",
  "recallMaxTokens": 512,
  "recallTagGroups": [
    {"not": {"tags": ["sensitivity:confidential", "sensitivity:restricted"], "match": "any_strict"}}
  ],
  "llmProvider": "openai",
  "llmModel": "gpt-4o-mini"
}
```

### Department Groups

```json5
// groups/sales.json5
{
  "displayName": "Sales Team",
  "members": ["bob", "charlie"],
  "recallTagGroups": [
    {"tags": ["department:sales"], "match": "any"}
  ],
  "retainTags": ["department:sales"]
}
```

### Anonymous Fallback (required)

```json5
// groups/_default.json5
{
  "displayName": "Anonymous",
  "members": [],
  "recall": false,
  "retain": false
}
```

## Group Fields

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string | Human-readable name |
| `members` | string[] | Canonical user IDs (file names from `users/`) |
| `recall` | boolean | Can read from memory |
| `retain` | boolean | Can write to memory |
| `retainRoles` | string[] | Message roles retained: `user`, `assistant`, `system`, `tool` |
| `retainTags` | string[] | Tags added to all retained facts |
| `retainEveryNTurns` | number | Retain every Nth turn |
| `recallBudget` | string | Recall effort: `low`, `mid`, `high` |
| `recallMaxTokens` | number | Max tokens injected per turn |
| `recallTagGroups` | TagGroup[] or null | Tag filter for recall. `null` = no filter. |
| `llmModel` | string | LLM model for extraction |
| `llmProvider` | string | LLM provider for extraction |
| `excludeProviders` | string[] | Skip these message providers |

## Merge Rules (multiple groups)

When a user belongs to multiple groups:

| Field | Rule |
|-------|------|
| `recall`, `retain` | Most permissive wins (`true > false`) |
| `retainRoles`, `retainTags` | Unioned |
| `recallBudget` | Most permissive (`high > mid > low`) |
| `recallMaxTokens` | Highest value wins |
| `recallTagGroups` | AND-ed together |
| `llmModel`, `llmProvider` | Alphabetically first group that defines it wins |
| `retainEveryNTurns` | Lowest value wins (most frequent) |
| `excludeProviders` | Unioned (most restrictive) |

## Bank-Level Permissions

Each bank can override group defaults — the most specific scope wins:

```json5
// In bank config
{
  "permissions": {
    "groups": {
      "executive": { "recall": true, "retain": true },
      "dept-head": { "recall": true, "retain": false },
      "_default":  { "recall": false, "retain": false }
    },
    "users": {
      "bob": { "recallBudget": "high", "recallMaxTokens": 2048 }
    }
  }
}
```

## Resolution Algorithm

Per-field, most specific scope wins:

1. **Merge global groups** — collect all user's groups, merge with rules above
2. **Bank `_default` baseline** — if bank has `permissions.groups._default`, start there
3. **Bank group overlay** — merge bank-level group entries for this user's groups
4. **Bank user override** — apply per-user override if defined

Banks without `permissions` fall through to global group defaults (backward compatible).

## Tag-Based Filtering

`recallTagGroups` uses Hindsight's `tag_groups` API for boolean filtering:

```json5
// Exclude restricted content
{"not": {"tags": ["sensitivity:restricted"], "match": "any_strict"}}

// Include only department content (plus untagged)
{"tags": ["department:sales"], "match": "any"}
```

Tags come from two sources:
1. **Code-level** — `retainTags` from groups + auto `user:<id>` tag
2. **LLM-extracted** — entity labels with `tag: true` in bank config

Both merge into a single `tags` array on each fact.
