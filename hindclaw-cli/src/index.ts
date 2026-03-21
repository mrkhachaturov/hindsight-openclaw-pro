#!/usr/bin/env node

import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import JSON5 from 'json5';
import { HindsightClient } from '../client.js';
import { loadBankConfigFiles } from '../config.js';
import { planBank, type BankPlan, type ConfigChange, type DirectiveChange } from '../sync/plan.js';
import { applyBank } from '../sync/apply.js';
import { importBank, formatBankConfigAsJson5 } from '../sync/import.js';
import { runInit } from './init.js';
import type { PluginConfig } from '../types.js';

// ── Argument parsing ────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const command = args[0]; // plan, apply, import
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--all') {
      flags.all = true;
    } else if (args[i] === '--agent' && args[i + 1]) {
      flags.agent = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      flags.output = args[i + 1];
      i++;
    } else if (args[i] === '--config' && args[i + 1]) {
      flags.config = args[i + 1];
      i++;
    } else if (args[i] === '--api-url' && args[i + 1]) {
      flags.apiUrl = args[i + 1];
      i++;
    } else if (args[i] === '--auto-approve' || args[i] === '-y') {
      flags.autoApprove = true;
    } else if (args[i] === '--from-existing') {
      flags.fromExisting = true;
    } else if (args[i] === '--force' || args[i] === '-f') {
      flags.force = true;
    }
  }

  return { command, flags };
}

// ── Config loading ──────────────────────────────────────────────────

export function loadPluginConfig(configPath: string): PluginConfig {
  const content = readFileSync(configPath, 'utf-8');
  const config = JSON5.parse(content);
  return config?.plugins?.entries?.['hindclaw']?.config ?? {};
}

function resolveApiUrl(pluginConfig: PluginConfig, flagOverride?: string): string {
  if (flagOverride) return flagOverride;
  if (pluginConfig.hindsightApiUrl) return pluginConfig.hindsightApiUrl;
  const port = pluginConfig.apiPort || 9077;
  return `http://127.0.0.1:${port}`;
}

function createClient(pluginConfig: PluginConfig, apiUrlOverride?: string): HindsightClient {
  return new HindsightClient({
    apiUrl: resolveApiUrl(pluginConfig, apiUrlOverride),
    apiToken: pluginConfig.hindsightApiToken,
  });
}

// ── Plan formatter (terraform-style) ────────────────────────────────

const isTTY = process.stdout.isTTY ?? false;
const c = {
  green:  (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:    (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:   (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  dim:    (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
};

function formatInline(v: unknown): string {
  if (v === undefined || v === null) return c.dim('(null)');
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === 'object') return `{ ${Object.keys(v).join(', ')} }`;
  return String(v);
}

function formatBlock(v: unknown, prefix: string, indent: number): string[] {
  const json = JSON.stringify(v, null, 2);
  const pad = ' '.repeat(indent);
  return json.split('\n').map(line => `${pad}${prefix} ${line}`);
}

function diffObject(oldVal: unknown, newVal: unknown, depth: number): string[] {
  const lines: string[] = [];
  const pad = ' '.repeat(depth);

  // Both are plain objects — diff field by field
  if (oldVal && newVal && typeof oldVal === 'object' && typeof newVal === 'object'
      && !Array.isArray(oldVal) && !Array.isArray(newVal)) {
    const oldObj = oldVal as Record<string, unknown>;
    const newObj = newVal as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

    for (const key of allKeys) {
      const o = oldObj[key];
      const n = newObj[key];
      if (o === undefined) {
        // Added key
        lines.push(`${pad}  ${c.green('+')} ${c.green(key)} = ${c.green(formatInline(n))}`);
      } else if (n === undefined) {
        // Removed key
        lines.push(`${pad}  ${c.red('-')} ${c.red(key)} = ${c.red(formatInline(o))}`);
      } else if (JSON.stringify(o) !== JSON.stringify(n)) {
        // Changed key — for simple values show inline, for complex recurse
        if (typeof o !== 'object' || typeof n !== 'object' || o === null || n === null) {
          lines.push(`${pad}  ${c.yellow('~')} ${key} = ${c.red(formatInline(o))} ${c.dim('→')} ${c.green(formatInline(n))}`);
        } else {
          lines.push(`${pad}  ${c.yellow('~')} ${key} {`);
          lines.push(...diffObject(o, n, depth + 4));
          lines.push(`${pad}    }`);
        }
      }
      // unchanged keys: skip (terraform hides them too)
    }
    return lines;
  }

  // Fallback: show old → new as blocks
  lines.push(...formatBlock(oldVal, c.red('-'), depth + 2));
  lines.push(...formatBlock(newVal, c.green('+'), depth + 2));
  return lines;
}

function printConfigChange(change: ConfigChange): string[] {
  const lines: string[] = [];

  if (change.action === 'add') {
    lines.push(`  ${c.green('+')} ${c.bold(change.field)}`);
    if (typeof change.newValue === 'string') {
      lines.push(`      ${c.green('= ' + formatInline(change.newValue))}`);
    } else if (typeof change.newValue === 'number' || typeof change.newValue === 'boolean') {
      lines.push(`      ${c.green('= ' + String(change.newValue))}`);
    } else {
      lines.push(...formatBlock(change.newValue, c.green('+'), 6));
    }
  } else if (change.action === 'remove') {
    lines.push(`  ${c.red('-')} ${c.bold(change.field)}`);
    if (typeof change.oldValue === 'string') {
      lines.push(`      ${c.red('= ' + formatInline(change.oldValue))}`);
    } else {
      lines.push(...formatBlock(change.oldValue, c.red('-'), 6));
    }
  } else {
    // change
    lines.push(`  ${c.yellow('~')} ${c.bold(change.field)}`);
    if (typeof change.oldValue !== 'object' || typeof change.newValue !== 'object'
        || change.oldValue === null || change.newValue === null) {
      // Simple scalar change
      lines.push(`      ${c.red(formatInline(change.oldValue))} ${c.dim('→')} ${c.green(formatInline(change.newValue))}`);
    } else {
      // Structured diff
      lines.push(...diffObject(change.oldValue, change.newValue, 4));
    }
  }

  return lines;
}

function printDirectiveChange(change: DirectiveChange): string[] {
  const lines: string[] = [];
  if (change.action === 'create') {
    lines.push(`  ${c.green('+')} ${c.bold('directive:')} ${change.name}`);
    if (change.content) lines.push(`      ${c.green('= "' + truncate(change.content, 100) + '"')}`);
  } else if (change.action === 'delete') {
    lines.push(`  ${c.red('-')} ${c.bold('directive:')} ${change.name}`);
  } else {
    lines.push(`  ${c.yellow('~')} ${c.bold('directive:')} ${change.name}`);
    if (change.content) lines.push(`      ${c.green('= "' + truncate(change.content, 100) + '"')}`);
  }
  return lines;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max) + '...' : s;
}

function printPlan(plan: BankPlan): { adds: number; changes: number; removes: number } {
  let adds = 0, changes = 0, removes = 0;

  console.log(`\n${c.bold(`# bank.${plan.agentId}`)} (${plan.bankId})`);
  console.log('');

  for (const change of plan.configChanges) {
    if (change.action === 'add') adds++;
    else if (change.action === 'change') changes++;
    else removes++;
    for (const line of printConfigChange(change)) console.log(line);
    console.log('');
  }

  for (const change of plan.directiveChanges) {
    if (change.action === 'create') adds++;
    else if (change.action === 'update') changes++;
    else removes++;
    for (const line of printDirectiveChange(change)) console.log(line);
    console.log('');
  }

  return { adds, changes, removes };
}

function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

function printSummary(adds: number, changes: number, removes: number): void {
  const parts: string[] = [];
  if (adds > 0) parts.push(c.green(`${adds} to add`));
  if (changes > 0) parts.push(c.yellow(`${changes} to change`));
  if (removes > 0) parts.push(c.red(`${removes} to destroy`));
  console.log(`\nPlan: ${parts.join(', ')}.`);
}

// ── Commands ────────────────────────────────────────────────────────

async function runPlan(pluginConfig: PluginConfig, configDir: string, agentId?: string, apiUrlOverride?: string) {
  const client = createClient(pluginConfig, apiUrlOverride);
  const agents = pluginConfig.agents ?? {};
  const bankConfigs = loadBankConfigFiles(agents, configDir);

  const targetAgents = agentId ? [agentId] : Object.keys(agents);
  let totalAdds = 0, totalChanges = 0, totalRemoves = 0;

  for (const id of targetAgents) {
    const bankConfig = bankConfigs.get(id);
    if (!bankConfig) { console.log(`${c.yellow('⚠')} ${id}: no bank config found`); continue; }

    const plan = await planBank(id, id, bankConfig, client);

    if (!plan.hasChanges) continue;

    const { adds, changes, removes } = printPlan(plan);
    totalAdds += adds;
    totalChanges += changes;
    totalRemoves += removes;
  }

  const total = totalAdds + totalChanges + totalRemoves;
  if (total === 0) {
    console.log(`\n${c.green('No changes.')} Infrastructure is up-to-date.`);
  } else {
    printSummary(totalAdds, totalChanges, totalRemoves);
  }
}

async function runApply(pluginConfig: PluginConfig, configDir: string, agentId?: string, apiUrlOverride?: string, autoApprove = false) {
  const client = createClient(pluginConfig, apiUrlOverride);
  const agents = pluginConfig.agents ?? {};
  const bankConfigs = loadBankConfigFiles(agents, configDir);

  const targetAgents = agentId ? [agentId] : Object.keys(agents);

  // Phase 1: Plan all banks
  const plans: BankPlan[] = [];
  let totalAdds = 0, totalChanges = 0, totalRemoves = 0;

  for (const id of targetAgents) {
    const bankConfig = bankConfigs.get(id);
    if (!bankConfig) { console.log(`${c.yellow('⚠')} ${id}: no bank config found`); continue; }

    const plan = await planBank(id, id, bankConfig, client);
    if (!plan.hasChanges) continue;

    const { adds, changes, removes } = printPlan(plan);
    totalAdds += adds;
    totalChanges += changes;
    totalRemoves += removes;
    plans.push(plan);
  }

  if (plans.length === 0) {
    console.log(`\n${c.green('No changes.')} Infrastructure is up-to-date.`);
    return;
  }

  // Phase 2: Summary + confirmation
  printSummary(totalAdds, totalChanges, totalRemoves);

  if (!autoApprove) {
    console.log('');
    const approved = await confirm(`Do you want to perform these actions? Only 'yes' will be accepted: `);
    if (!approved) {
      console.log('\nApply cancelled.');
      return;
    }
    console.log('');
  }

  // Phase 3: Apply
  let updated = 0;
  for (const plan of plans) {
    const result = await applyBank(plan, client);
    updated++;

    const parts: string[] = [];
    if (result.configUpdated) parts.push('config updated');
    if (result.directivesCreated) parts.push(`${result.directivesCreated} directive(s) created`);
    if (result.directivesUpdated) parts.push(`${result.directivesUpdated} directive(s) updated`);
    if (result.directivesDeleted) parts.push(`${result.directivesDeleted} directive(s) deleted`);

    console.log(`${c.green('✓')} ${c.bold(plan.agentId)} applied (${parts.join(', ')})`);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.error(`  ${c.red('✗')} ${err}`);
      }
    }
  }

  console.log(`\n${c.bold('Apply complete!')} ${updated} banks updated.`);
}

async function runImport(pluginConfig: PluginConfig, agentId: string, outputPath: string, apiUrlOverride?: string) {
  const client = createClient(pluginConfig, apiUrlOverride);
  const bankId = agentId;

  const result = await importBank(bankId, client);
  const content = formatBankConfigAsJson5(result.bankConfig);

  const fullPath = resolve(process.cwd(), outputPath);
  writeFileSync(fullPath, content, 'utf-8');

  console.log(`${c.green('✓')} Imported bank ${c.bold(bankId)} → ${outputPath}`);
  console.log(`  ${result.stats.configFields} config fields, ${result.stats.directives} directives`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const { command, flags } = parseArgs(process.argv);

  if (!command || !['plan', 'apply', 'import', 'init'].includes(command)) {
    console.log('Usage:');
    console.log('  hindclaw plan   [--agent <id> | --all] [--config <path>] [--api-url <url>]');
    console.log('  hindclaw apply  [--agent <id> | --all] [--config <path>] [--api-url <url>] [--auto-approve|-y]');
    console.log('  hindclaw import --agent <id> --output <path> [--config <path>] [--api-url <url>]');
    console.log('  hindclaw init   [--from-existing] [--force|-f] [--config <path>]');
    console.log('');
    console.log('Commands:');
    console.log('  plan     Preview changes (diff local vs server)');
    console.log('  apply    Apply changes to Hindsight server');
    console.log('  import   Pull server state into local file');
    console.log('  init     Bootstrap .openclaw/hindsight/ directory structure');
    process.exit(1);
  }

  const configPath = resolve(
    process.cwd(),
    (flags.config as string) ?? process.env.OPENCLAW_CONFIG_PATH ?? '.openclaw/openclaw.json',
  );
  const pluginConfig = loadPluginConfig(configPath);
  const configDir = dirname(configPath);
  const apiUrlOverride = flags.apiUrl as string | undefined;

  try {
    switch (command) {
      case 'plan':
        await runPlan(pluginConfig, configDir, flags.agent as string, apiUrlOverride);
        break;
      case 'apply':
        await runApply(pluginConfig, configDir, flags.agent as string, apiUrlOverride, !!flags.autoApprove);
        break;
      case 'import':
        if (!flags.agent || !flags.output) {
          console.error('import requires --agent and --output');
          process.exit(1);
        }
        await runImport(pluginConfig, flags.agent as string, flags.output as string, apiUrlOverride);
        break;
      case 'init':
        await runInit({ configPath, fromExisting: !!flags.fromExisting, force: !!flags.force });
        break;
    }
  } catch (err) {
    console.error(`${c.red('Error:')} ${err}`);
    process.exit(1);
  }
}

main();
