---
sidebar_position: 2
title: CLI Reference
---

# CLI Reference

The `hindclaw` CLI manages Hindsight bank configurations using an infrastructure-as-code approach. Local bank config files are the source of truth. The CLI diffs local state against the server and applies changes.

## Commands

### `hindclaw plan`

Preview what will change on the server without modifying anything. Compares each local bank config file against the current server state and displays a diff.

**Syntax:**

```bash
hindclaw plan --all
hindclaw plan --agent <id>
hindclaw plan --agent <id> --config <path>
hindclaw plan --agent <id> --api-url <url>
```

**Example output:**

```
# bank.agent-1 (agent-1)

  + retain_strategies
      + {
      +   "detailed": {
      +     "retain_extraction_mode": "verbose",
      +     "retain_mission": "Extract financial metrics..."
      +   }
      + }

  ~ retain_mission
    "Extract financial data..." -> "Extract financial metrics, P&L, cashflow..."

  - old_directive
    "Deprecated instruction that will be removed"

Plan: 2 to add, 1 to change, 1 to destroy.
```

Diff symbols:

| Symbol | Meaning |
|--------|---------|
| `+` | Field or value will be added |
| `~` | Field or value will be changed |
| `-` | Field or value will be removed |

---

### `hindclaw apply`

Show the plan, prompt for confirmation, then apply changes to the server. Equivalent to `plan` followed by execution.

**Syntax:**

```bash
hindclaw apply --all
hindclaw apply --agent <id>
hindclaw apply --agent <id> --auto-approve
```

With `--auto-approve` (or `-y`), the confirmation prompt is skipped. Use this in CI/CD pipelines or automation scripts.

**Behavior:**
- Server-side fields in the bank config are synced to the Hindsight API.
- Directives not present in the local file are deleted from the server.
- Strategies not present in the local file are removed from the server.
- If the bank does not exist on the server, it is created automatically.

---

### `hindclaw import`

Pull the current server-side configuration for a bank into a local JSON5 file. Useful for bootstrapping local config from an existing server, or auditing server state.

**Syntax:**

```bash
hindclaw import --agent <id> --output <path>
```

**Example:**

```bash
hindclaw import --agent r4p17 --output ./banks/r4p17.json5
```

The generated file contains only server-side fields (missions, dispositions, entity labels, directives, strategies). Behavioral overrides are not included since they exist only in local config.

---

### `hindclaw init`

Bootstrap the `.openclaw/hindsight/` directory structure for access control configuration. Creates template files for banks, groups, and user permissions.

**Syntax:**

```bash
hindclaw init
hindclaw init --from-existing
hindclaw init --from-existing --force
```

| Variant | Description |
|---------|-------------|
| `hindclaw init` | Fresh setup with empty template files. |
| `hindclaw init --from-existing` | Migrate current inline plugin config and bank files into the new directory structure. |
| `hindclaw init --from-existing --force` | Same as above, but overwrite any existing `.openclaw/hindsight/` directory. |

## Global Options

These options are available on all commands.

| Option | Short | Description |
|--------|-------|-------------|
| `--agent <id>` | | Target a single agent by its ID (as defined in the `agents` map). |
| `--all` | | Target all configured agents. |
| `--config <path>` | | Path to the OpenClaw config file. Defaults to the `OPENCLAW_CONFIG_PATH` environment variable, or `.openclaw/openclaw.json`. |
| `--api-url <url>` | | Override the Hindsight API URL for this invocation. Takes precedence over both plugin config and bank config. |
| `--auto-approve` | `-y` | Skip the confirmation prompt (applies to `apply` only). |
| `--from-existing` | | Migrate current config into the new directory structure (`init` only). |
| `--force` | `-f` | Overwrite an existing hindsight directory (`init` only). |
