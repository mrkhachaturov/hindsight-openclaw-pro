#!/usr/bin/env node

import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import JSON5 from 'json5';
import { HindsightClient } from '../client.js';
import { loadBankConfigFiles } from '../config.js';
import { planBank } from '../sync/plan.js';
import { applyBank } from '../sync/apply.js';
import { importBank, formatBankConfigAsJson5 } from '../sync/import.js';
import type { PluginConfig } from '../types.js';

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
    }
  }

  return { command, flags };
}

function loadPluginConfig(configPath: string): PluginConfig {
  const content = readFileSync(configPath, 'utf-8');
  const config = JSON5.parse(content);
  // Navigate to plugin config
  return config?.plugins?.entries?.['hindsight-openclaw-pro']?.config ?? {};
}

function createClient(pluginConfig: PluginConfig): HindsightClient {
  return new HindsightClient({
    apiUrl: pluginConfig.hindsightApiUrl,
    apiToken: pluginConfig.hindsightApiToken,
  });
}

async function runPlan(pluginConfig: PluginConfig, agentId?: string) {
  const client = createClient(pluginConfig);
  const agents = pluginConfig.agents ?? {};
  const configDir = resolve(process.cwd(), '.openclaw');
  const bankConfigs = loadBankConfigFiles(agents, configDir);

  const targetAgents = agentId ? [agentId] : Object.keys(agents);
  let totalChanges = 0;

  for (const id of targetAgents) {
    const bankConfig = bankConfigs.get(id);
    if (!bankConfig) { console.log(`⚠ ${id}: no bank config found`); continue; }

    // Use agent ID as bank ID for plan (simplified — full derivation needs context)
    const bankId = id;
    const plan = await planBank(id, bankId, bankConfig, client);

    if (!plan.hasChanges) {
      console.log(`  ${id}: no changes`);
      continue;
    }

    totalChanges++;
    console.log(`\nBank: ${id} (${bankId})`);
    for (const c of plan.configChanges) {
      const symbol = c.action === 'add' ? '+' : c.action === 'change' ? '~' : '-';
      console.log(`  ${symbol} ${c.field} (${c.action})`);
    }
    for (const d of plan.directiveChanges) {
      const symbol = d.action === 'create' ? '+' : d.action === 'update' ? '~' : '-';
      console.log(`  ${symbol} directive: ${d.name} (${d.action})`);
    }
  }

  console.log(`\n${targetAgents.length} banks checked, ${totalChanges} have changes.`);
}

async function runApply(pluginConfig: PluginConfig, agentId?: string) {
  const client = createClient(pluginConfig);
  const agents = pluginConfig.agents ?? {};
  const configDir = resolve(process.cwd(), '.openclaw');
  const bankConfigs = loadBankConfigFiles(agents, configDir);

  const targetAgents = agentId ? [agentId] : Object.keys(agents);
  let updated = 0;

  for (const id of targetAgents) {
    const bankConfig = bankConfigs.get(id);
    if (!bankConfig) { console.log(`⚠ ${id}: no bank config found`); continue; }

    const bankId = id;
    const plan = await planBank(id, bankId, bankConfig, client);

    if (!plan.hasChanges) {
      console.log(`Skipping ${id} (no changes)`);
      continue;
    }

    const result = await applyBank(plan, client);
    updated++;

    const parts: string[] = [];
    if (result.configUpdated) parts.push('config updated');
    if (result.directivesCreated) parts.push(`${result.directivesCreated} directive(s) created`);
    if (result.directivesUpdated) parts.push(`${result.directivesUpdated} directive(s) updated`);
    if (result.directivesDeleted) parts.push(`${result.directivesDeleted} directive(s) deleted`);

    console.log(`Applying ${id}... ✓ (${parts.join(', ')})`);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.error(`  ⚠ ${err}`);
      }
    }
  }

  console.log(`\nDone. ${updated} banks updated, ${targetAgents.length - updated} unchanged.`);
}

async function runImport(pluginConfig: PluginConfig, agentId: string, outputPath: string) {
  const client = createClient(pluginConfig);
  const bankId = agentId; // simplified

  const result = await importBank(bankId, client);
  const content = formatBankConfigAsJson5(result.bankConfig);

  const fullPath = resolve(process.cwd(), outputPath);
  writeFileSync(fullPath, content, 'utf-8');

  console.log(`Imported bank ${bankId} → ${outputPath}`);
  console.log(`  ${result.stats.configFields} config fields, ${result.stats.directives} directives`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv);

  if (!command || !['plan', 'apply', 'import'].includes(command)) {
    console.log('Usage:');
    console.log('  hoppro plan [--agent <id> | --all] [--config <path>]');
    console.log('  hoppro apply [--agent <id> | --all] [--config <path>]');
    console.log('  hoppro import --agent <id> --output <path> [--config <path>]');
    process.exit(1);
  }

  const configPath = resolve(process.cwd(), (flags.config as string) ?? '.openclaw/openclaw.json');
  const pluginConfig = loadPluginConfig(configPath);

  try {
    switch (command) {
      case 'plan':
        await runPlan(pluginConfig, flags.agent as string);
        break;
      case 'apply':
        await runApply(pluginConfig, flags.agent as string);
        break;
      case 'import':
        if (!flags.agent || !flags.output) {
          console.error('import requires --agent and --output');
          process.exit(1);
        }
        await runImport(pluginConfig, flags.agent as string, flags.output as string);
        break;
    }
  } catch (err) {
    console.error(`Error: ${err}`);
    process.exit(1);
  }
}

main();
