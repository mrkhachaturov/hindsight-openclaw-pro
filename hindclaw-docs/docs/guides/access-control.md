---
sidebar_position: 2
title: Access Control
---

# Access Control

hindclaw provides per-user memory permissions enforced server-side through the `hindclaw-extension` -- a set of Hindsight server extensions that authenticate requests, resolve permissions, and enrich operations via `accept_with()`. The same user can get different behavior on different agents, channels, and topics -- different access flags, different tag visibility, different retain strategies.

All user, group, and permission data lives in the Hindsight PostgreSQL database and is managed through the HTTP API at `/ext/hindclaw/*`. The plugin itself is a thin adapter: it generates a JWT from the OpenClaw context and sends standard Hindsight API calls. It does not store or resolve permissions.

## How it works

Three Hindsight extensions in one pip package, sharing the same database:

```
Client (OpenClaw plugin / CLI / Dashboard)
  |
  |  Authorization: Bearer <jwt or api_key>
  v
Hindsight API Server
  |
  +-- HindclawTenant (TenantExtension)
  |     JWT -> sender -> user identity
  |     API key -> user lookup
  |
  +-- HindclawValidator (OperationValidatorExtension)
  |     user -> groups -> permissions -> accept_with(enrichment)
  |
  +-- HindclawHttp (HttpExtension)
  |     /ext/hindclaw/* CRUD API for users/groups/permissions
  |
  +-- Hindsight Core (retain/recall/reflect)
```

Install the extension package on the Hindsight server:

```bash
pip install hindclaw-extension
```

Configure via environment variables:

```bash
HINDSIGHT_API_TENANT_EXTENSION=hindclaw_ext.tenant:HindclawTenant
HINDSIGHT_API_OPERATION_VALIDATOR_EXTENSION=hindclaw_ext.validator:HindclawValidator
HINDSIGHT_API_HTTP_EXTENSION=hindclaw_ext.http:HindclawHttp

# Shared secret for JWT validation (must match plugin config)
HINDSIGHT_API_TENANT_JWT_SECRET=shared-secret

# Admin client IDs allowed to manage users/groups/permissions
HINDSIGHT_API_TENANT_ADMIN_CLIENTS=openclaw-prod,terraform
```

### Authentication

The extension accepts two token formats in the `Authorization` header:

**JWT** (for plugins acting on behalf of users):

```json
{
  "client_id": "openclaw-prod",
  "sender": "telegram:789012",
  "agent": "yoda",
  "channel": "telegram",
  "topic": "280304",
  "iat": 1711000000,
  "exp": 1711000300
}
```

| Claim | Description |
|---|---|
| `client_id` | Identifies the trusted client (for audit logs, future per-client scoping) |
| `sender` | Raw sender ID from the channel, format `provider:id` |
| `agent` | Agent (bank) ID from OpenClaw context |
| `channel` | Channel type (telegram, slack, etc.) |
| `topic` | Topic ID within the channel (optional) |
| `iat` / `exp` | Issued-at and expiration. Short-lived (5 min). HMAC-SHA256 signed. |

The plugin generates this JWT from the OpenClaw message context and signs it with a shared secret. Plugin config is minimal:

```json5
{
  "hindsightApiUrl": "https://hindsight.home.local",
  "jwtSecret": "shared-secret-between-plugin-and-server"
}
```

**API key** (for direct access -- CLI, dashboard, Terraform, personal tools):

```
Authorization: Bearer hc_vagan_xxxxxxxxxxxx
```

API keys are plain strings stored in the `hindclaw_api_keys` table. Each key maps to a user -- the same permissions apply. No sender/agent/topic context is available, so the strategy cascade uses defaults only. API keys are long-lived and revocable.

### Request flow

```mermaid
sequenceDiagram
    participant C as Client (Plugin)
    participant T as HindclawTenant
    participant V as HindclawValidator
    participant H as Hindsight Core

    C->>T: POST /v1/.../recall<br/>Authorization: Bearer <jwt>
    T->>T: Decode JWT, validate signature
    T->>T: sender telegram:789012 -> DB lookup -> user "vagan"
    T->>T: Set tenant_id = "vagan", store claims in contextvar
    T->>V: Pass to validator
    V->>V: Resolve permissions:<br/>vagan + bank yoda + groups + cascade
    V->>V: recall=true, tag_groups=[NOT restricted]

    alt Permitted
        V->>H: accept_with(tag_groups=...)
        H->>C: Filtered recall results
    else Denied
        V->>C: 403 reject("recall denied")
    end
```

## Setting up users and channels

Users are identity records that map platform-specific sender IDs to a canonical user. Create users and their channel mappings via the HTTP API.

### Create a user

```bash
curl -X POST https://hindsight.home.local/ext/hindclaw/users \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "alice",
    "display_name": "Alice",
    "email": "alice@example.com"
  }'
```

### Add channel mappings

Channel mappings link platform sender IDs to the canonical user. When a message arrives from Telegram user `123456`, the extension resolves it to user `alice`.

```bash
# Map Telegram sender ID
curl -X POST https://hindsight.home.local/ext/hindclaw/users/alice/channels \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "telegram",
    "sender_id": "123456"
  }'

# Map Slack sender ID
curl -X POST https://hindsight.home.local/ext/hindclaw/users/alice/channels \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "slack",
    "sender_id": "U123456"
  }'
```

### List and remove channels

```bash
# List all channel mappings for a user
curl https://hindsight.home.local/ext/hindclaw/users/alice/channels \
  -H "Authorization: Bearer $ADMIN_JWT"

# Remove a channel mapping
curl -X DELETE https://hindsight.home.local/ext/hindclaw/users/alice/channels/telegram/123456 \
  -H "Authorization: Bearer $ADMIN_JWT"
```

### Generate API keys for direct access

Users who access Hindsight directly (via CLI, personal tools, or dashboards) need API keys:

```bash
curl -X POST https://hindsight.home.local/ext/hindclaw/users/alice/api-keys \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Alice personal CLI"
  }'
# Returns: { "id": "key_abc123", "api_key": "hc_alice_xxxxxxxxxxxx", ... }
```

The returned `api_key` is used as a Bearer token. It grants the same permissions as the user it belongs to, without sender/agent/topic context.

## Creating groups with permissions

Groups define membership and permission defaults. There are two common patterns: role groups (controlling access levels) and department groups (adding contextual tags).

### Role groups

```bash
# Executive group -- full access, no tag filter
curl -X POST https://hindsight.home.local/ext/hindclaw/groups \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "executives",
    "display_name": "Executive",
    "recall": true,
    "retain": true,
    "retain_roles": ["user", "assistant", "tool"],
    "retain_tags": ["role:executive"],
    "recall_budget": "high",
    "recall_max_tokens": 2048,
    "recall_tag_groups": null
  }'

# Staff group -- limited access, restricted content filtered
curl -X POST https://hindsight.home.local/ext/hindclaw/groups \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "staff",
    "display_name": "Staff",
    "recall": true,
    "retain": true,
    "retain_roles": ["assistant"],
    "retain_tags": ["role:staff"],
    "retain_every_n_turns": 2,
    "recall_budget": "low",
    "recall_max_tokens": 512,
    "recall_tag_groups": [
      {"not": {"tags": ["sensitivity:restricted"], "match": "any_strict"}}
    ],
    "llm_provider": "openai",
    "llm_model": "gpt-4o-mini"
  }'
```

Key difference: executives see everything (`recall_tag_groups: null` means no filter), while staff are filtered -- they never see facts tagged `sensitivity:restricted`.

### Department groups

Department groups add contextual tags without changing access levels:

```bash
curl -X POST https://hindsight.home.local/ext/hindclaw/groups \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "sales-team",
    "display_name": "Sales Team",
    "recall_tag_groups": [
      {"tags": ["department:sales"], "match": "any"}
    ],
    "retain_tags": ["department:sales"]
  }'
```

A user can belong to both a role group and a department group. The merge rules combine their permissions.

### Add members to groups

```bash
curl -X POST https://hindsight.home.local/ext/hindclaw/groups/executives/members \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice"}'

curl -X POST https://hindsight.home.local/ext/hindclaw/groups/staff/members \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "bob"}'

curl -X POST https://hindsight.home.local/ext/hindclaw/groups/sales-team/members \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "bob"}'
```

### The _default fallback

The `_default` group is required. It is created automatically when the extension starts. It applies to any sender not found in the channel mappings -- anonymous or unknown users.

By default, `_default` blocks both recall and retain:

```bash
# Update _default to allow read-only anonymous access
curl -X PUT https://hindsight.home.local/ext/hindclaw/groups/_default \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Anonymous",
    "recall": true,
    "retain": false
  }'
```

## Configurable fields

Every field below can be set at the group level, and overridden at the bank level per-group or per-user:

| Field | Type | Description |
|---|---|---|
| `recall` | boolean | Can read from memory |
| `retain` | boolean | Can write to memory |
| `retain_roles` | string[] | Message roles retained: `user`, `assistant`, `system`, `tool` |
| `retain_tags` | string[] | Tags added to all retained facts |
| `retain_every_n_turns` | number | Retain every Nth turn |
| `retain_strategy` | string | Named retain strategy (from cascade, see below) |
| `recall_budget` | `low` / `mid` / `high` | Recall effort level |
| `recall_max_tokens` | number | Max tokens injected per turn |
| `recall_tag_groups` | TagGroup[] or null | Tag filter for recall (`null` = no filter) |
| `llm_model` | string | LLM model for extraction |
| `llm_provider` | string | LLM provider for extraction |
| `exclude_providers` | string[] | Skip these message providers |

### Server-enforced vs client-enforced

The extension enforces permissions server-side via `accept_with()` for fields the server can control:

- **Server-enforced**: `recall`, `retain`, `retain_tags`, `retain_strategy`, `recall_tag_groups`
- **Client-enforced**: `recall_budget`, `recall_max_tokens`, `retain_every_n_turns`, `llm_model`, `llm_provider`, `exclude_providers`

Client-enforced fields are still stored in the database and returned by the debug endpoint. Clients (the plugin) read them and apply them locally.

## Bank-level permission overrides

Each bank can override group defaults for specific groups or users. This is how the same user gets different behavior on different agents.

```bash
# On Yoda: staff can recall but not retain
curl -X PUT https://hindsight.home.local/ext/hindclaw/banks/yoda/permissions/groups/staff \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "recall": true,
    "retain": false
  }'

# On K2SO: Bob gets elevated recall
curl -X PUT https://hindsight.home.local/ext/hindclaw/banks/k2so/permissions/users/bob \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "recall_budget": "high",
    "recall_max_tokens": 2048
  }'
```

List all permission overrides for a bank:

```bash
curl https://hindsight.home.local/ext/hindclaw/banks/yoda/permissions \
  -H "Authorization: Bearer $ADMIN_JWT"
```

Banks without any permission overrides fall through to global group defaults.

## Strategy cascade

The strategy cascade determines which named retain strategy to use for a given request. It has 5 levels, from least specific to most specific. Most specific wins.

```
agent -> channel -> topic -> group -> user
```

```mermaid
graph LR
    A["agent<br/>(bank default)"] --> B["channel<br/>(telegram, slack)"]
    B --> C["topic<br/>(topic ID)"]
    C --> D["group<br/>(dept-head, sales)"]
    D --> E["user<br/>(vagan, alice)"]

    style A fill:#64748b,color:#fff,stroke:#64748b
    style B fill:#6366f1,color:#fff,stroke:#6366f1
    style C fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style D fill:#a855f7,color:#fff,stroke:#a855f7
    style E fill:#c026d3,color:#fff,stroke:#c026d3
```

Strategy scopes are managed per-bank:

```bash
# Default strategy for all Yoda traffic
curl -X PUT https://hindsight.home.local/ext/hindclaw/banks/yoda/strategies/agent/yoda \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"strategy": "general"}'

# Telegram channel gets a different strategy
curl -X PUT https://hindsight.home.local/ext/hindclaw/banks/yoda/strategies/channel/telegram \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"strategy": "chat-extract"}'

# Specific topic gets a project-focused strategy
curl -X PUT https://hindsight.home.local/ext/hindclaw/banks/yoda/strategies/topic/280304 \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"strategy": "project-alpha"}'

# A specific user always uses their personal strategy
curl -X PUT https://hindsight.home.local/ext/hindclaw/banks/yoda/strategies/user/vagan \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"strategy": "vagan-personal"}'
```

The resolver picks the most specific matching scope. If user `vagan` sends a message in Telegram topic `280304` on bank `yoda`, the cascade checks (most specific first): user `vagan` > group membership > topic `280304` > channel `telegram` > agent `yoda`. The first match wins.

## The resolution algorithm

For each incoming request, permissions are resolved through 4 steps. The same algorithm that previously ran in the plugin now runs server-side in `hindclaw_ext/resolver.py`.

```mermaid
graph TD
    MSG["Incoming request with JWT"] --> AUTH["HindclawTenant: authenticate"]
    AUTH --> ID["Step 1: Resolve identity<br/>sender -> user via channel mapping"]
    ID --> GROUPS["Step 2: Merge global groups<br/>all user's groups merged"]
    GROUPS --> BANK{"Step 3: Bank overrides?"}
    BANK -->|_default baseline| BD["Bank _default entry"]
    BANK -->|group overrides| BG["Bank group permissions"]
    BANK -->|user override| BU["Bank user permissions"]
    BD --> MERGE["Merge layers"]
    BG --> MERGE
    BU --> MERGE
    BANK -->|none| GLOBAL["Global group defaults only"]
    GLOBAL --> RESOLVED["Step 4: Resolved permissions"]
    MERGE --> RESOLVED
    RESOLVED --> ENRICH["accept_with() enrichment<br/>tags, tag_groups, strategy"]

    style MSG fill:#1d4ed8,color:#fff,stroke:#1d4ed8
    style AUTH fill:#475569,color:#fff,stroke:#475569
    style ID fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style GROUPS fill:#8b5cf6,color:#fff,stroke:#8b5cf6
    style BD fill:#c2410c,color:#fff,stroke:#c2410c
    style BG fill:#c2410c,color:#fff,stroke:#c2410c
    style BU fill:#c2410c,color:#fff,stroke:#c2410c
    style GLOBAL fill:#c2410c,color:#fff,stroke:#c2410c
    style RESOLVED fill:#0f766e,color:#fff,stroke:#0f766e
    style ENRICH fill:#10b981,color:#fff,stroke:#10b981
```

The steps in detail:

1. **Resolve identity** -- The TenantExtension decodes the JWT and extracts `sender` (e.g., `telegram:789012`). It looks up the `hindclaw_user_channels` table to find the canonical user. If no match, the user is anonymous (`_anonymous`).

2. **Merge global groups** -- Find all groups the user belongs to via `hindclaw_group_members`. Merge their permissions using the rules below. If the user is anonymous, only `_default` applies.

3. **Bank overlay** -- If the target bank has entries in `hindclaw_bank_permissions`:
   - Start with the bank's `_default` entry if one exists (baseline for this bank)
   - Overlay bank-level group entries for each of the user's groups
   - Overlay the bank-level user entry if one exists (most specific, wins)

4. **Resolved permissions + strategy** -- The result is a single flat `ResolvedPermissions` object. The strategy cascade runs separately against `hindclaw_strategy_scopes` using the JWT claims (agent, channel, topic) and user/group context. The validator then calls `accept_with()` to enrich the Hindsight operation with tags, tag_groups, and strategy.

### Merge rules

When a user belongs to multiple groups, their permissions are merged field by field:

| Field | Merge rule |
|---|---|
| `recall`, `retain` | Most permissive wins (`true` beats `false`) |
| `retain_roles`, `retain_tags` | Unioned (all values combined) |
| `recall_budget` | Most permissive (`high` > `mid` > `low`) |
| `recall_max_tokens` | Highest value wins |
| `recall_tag_groups` | AND-ed together (all filters must pass) |
| `llm_model`, `llm_provider` | Alphabetically first group that defines it wins |
| `retain_every_n_turns` | Lowest value wins (most frequent retention) |
| `exclude_providers` | Unioned (most restrictive -- more providers excluded) |
| `retain_strategy` | From strategy cascade (separate resolution) |

Example: Bob is in both `staff` (recall_budget: low) and `sales-team`. If `sales-team` does not define `recall_budget`, Bob keeps `low`. If it defined `high`, Bob would get `high` (most permissive wins).

## Tag-based filtering

`recall_tag_groups` uses Hindsight's tag filtering API to control what memories a user can see during recall. The extension passes the resolved `tag_groups` to `accept_with()`, and Hindsight core applies the filter.

Tags on facts come from two sources:

1. **Extension-injected tags** -- `retain_tags` from groups (e.g., `role:executive`) plus automatic `user:<id>` tags, injected via `accept_with(contents=...)` during retain
2. **LLM-extracted tags** -- Entity labels with `tag: true` in the bank config (e.g., `department:motors`, `sensitivity:restricted`)

Filter examples:

```json5
// See everything (no filter)
"recall_tag_groups": null

// Exclude restricted content
"recall_tag_groups": [
  {"not": {"tags": ["sensitivity:restricted"], "match": "any_strict"}}
]

// Only see sales department content
"recall_tag_groups": [
  {"tags": ["department:sales"], "match": "any"}
]

// Complex: see sales OR motors, but never restricted
"recall_tag_groups": [
  {"or": [
    {"tags": ["department:sales"], "match": "any"},
    {"tags": ["department:motors"], "match": "any"}
  ]},
  {"not": {"tags": ["sensitivity:restricted"], "match": "any_strict"}}
]
```

## Debug endpoint

The debug endpoint resolves permissions for a given context without executing an operation. Use it for troubleshooting access issues.

```bash
curl "https://hindsight.home.local/ext/hindclaw/debug/resolve?sender=telegram:789012&bank=yoda&topic=280304" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

Returns the full resolved permissions:

```json
{
  "user_id": "vagan",
  "is_anonymous": false,
  "groups": ["dept-head", "motors"],
  "recall": true,
  "retain": false,
  "retain_roles": ["user", "assistant"],
  "retain_tags": ["role:dept-head", "department:motors", "user:vagan"],
  "retain_every_n_turns": 1,
  "retain_strategy": "project-alpha",
  "recall_budget": "mid",
  "recall_max_tokens": 1024,
  "recall_tag_groups": [
    {"not": {"tags": ["sensitivity:restricted"], "match": "any_strict"}}
  ],
  "llm_model": null,
  "llm_provider": null,
  "exclude_providers": [],
  "resolution_trace": {
    "identity": "telegram:789012 -> vagan",
    "global_groups": ["dept-head", "motors"],
    "bank_overrides": {
      "group:dept-head": {"retain": false},
      "user:vagan": null
    },
    "strategy_cascade": {
      "matched_scope": "topic",
      "matched_value": "280304",
      "strategy": "project-alpha"
    }
  }
}
```

The `resolution_trace` section shows exactly how each step contributed to the final result -- which groups were merged, which bank overrides applied, and which strategy scope matched.

## Practical example

Three users, two agents, different access:

| | yoda (strategic) | k2so (operations) |
|---|---|---|
| **alice** (executive) | recall + retain, high budget, no tag filter | recall + retain, high budget, no tag filter |
| **bob** (staff, sales) | recall only (bank override), mid budget | recall + retain, high budget (user override) |
| **anonymous** | blocked | blocked |

This requires the following API calls:

```bash
# 1. Create users
curl -X POST .../ext/hindclaw/users -d '{"id": "alice", "display_name": "Alice"}'
curl -X POST .../ext/hindclaw/users -d '{"id": "bob", "display_name": "Bob"}'

# 2. Map channels
curl -X POST .../ext/hindclaw/users/alice/channels -d '{"provider": "telegram", "sender_id": "111111"}'
curl -X POST .../ext/hindclaw/users/bob/channels -d '{"provider": "telegram", "sender_id": "222222"}'

# 3. Create groups
curl -X POST .../ext/hindclaw/groups -d '{
  "id": "executives", "display_name": "Executive",
  "recall": true, "retain": true, "recall_budget": "high",
  "recall_tag_groups": null
}'
curl -X POST .../ext/hindclaw/groups -d '{
  "id": "staff", "display_name": "Staff",
  "recall": true, "retain": true, "recall_budget": "low",
  "recall_max_tokens": 512
}'

# 4. Add members
curl -X POST .../ext/hindclaw/groups/executives/members -d '{"user_id": "alice"}'
curl -X POST .../ext/hindclaw/groups/staff/members -d '{"user_id": "bob"}'

# 5. Bank-level overrides
# Yoda: staff cannot retain
curl -X PUT .../ext/hindclaw/banks/yoda/permissions/groups/staff \
  -d '{"retain": false}'
# K2SO: Bob gets elevated recall
curl -X PUT .../ext/hindclaw/banks/k2so/permissions/users/bob \
  -d '{"recall_budget": "high", "recall_max_tokens": 2048}'

# 6. Verify
curl ".../ext/hindclaw/debug/resolve?sender=telegram:222222&bank=yoda"
# -> bob: recall=true, retain=false (bank override), recall_budget=low
```
