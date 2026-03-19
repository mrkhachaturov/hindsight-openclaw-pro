# CLI Reference

Terraform-style management of Hindsight bank configurations. Local bank config files are the source of truth.

## Commands

### `hindclaw plan`

Preview what will change without modifying the server.

```bash
hindclaw plan --all              # all configured agents
hindclaw plan --agent finance    # single agent
```

Output:

```
# bank.finance (finance)

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

### `hindclaw apply`

Show plan, ask for confirmation, apply changes.

```bash
hindclaw apply --all
hindclaw apply --agent finance
hindclaw apply --agent finance --auto-approve   # skip confirmation (CI)
```

### `hindclaw import`

Pull current server state into a local file.

```bash
hindclaw import --agent finance --output ./banks/finance.json5
```

### `hindclaw init`

Bootstrap the `.openclaw/hindsight/` directory structure for access control.

```bash
hindclaw init                           # fresh setup (empty templates)
hindclaw init --from-existing           # migrate current config + banks
hindclaw init --from-existing --force   # overwrite existing
```

## Options

| Option | Description |
|--------|-------------|
| `--agent <id>` | Target a single agent |
| `--all` | Target all configured agents |
| `--config <path>` | Config file path (default: `OPENCLAW_CONFIG_PATH` or `.openclaw/openclaw.json`) |
| `--api-url <url>` | Override Hindsight API URL |
| `--auto-approve` / `-y` | Skip confirmation prompt |
| `--from-existing` | Migrate current inline config + bank files (`init` only) |
| `--force` / `-f` | Overwrite existing hindsight directory (`init` only) |
