import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import JSON5 from 'json5';
import type { PluginConfig } from '../types.js';

export interface InitOptions {
  configPath: string;       // path to openclaw.json
  fromExisting?: boolean;   // migrate from current setup
  force?: boolean;          // overwrite existing hindsight dir
}

// Fields to extract from inline plugin config → config.json5
const CONFIG_FIELDS = [
  'apiPort', 'embedVersion', 'embedPackagePath', 'daemonIdleTimeout',
  'dynamicBankGranularity', 'dynamicBankId', 'bankIdPrefix',
  'bootstrap', 'debug',
  'hindsightApiUrl', 'hindsightApiToken',
  'llmProvider', 'llmModel',
  'autoRecall', 'autoRetain', 'recallBudget', 'recallMaxTokens',
  'recallTypes', 'retainRoles', 'retainEveryNTurns', 'excludeProviders',
];

export async function runInit(options: InitOptions): Promise<void> {
  const openclawDir = dirname(options.configPath);
  const hindsightDir = join(openclawDir, 'hindsight');

  // Safety check
  if (existsSync(hindsightDir) && !options.force) {
    throw new Error(`[hindclaw init] ${hindsightDir} already exists. Use --force to overwrite.`);
  }

  // Read current config
  const pluginConfig = loadPluginConfigLocal(options.configPath);

  // Create directory structure
  mkdirSync(join(hindsightDir, 'banks'), { recursive: true });
  mkdirSync(join(hindsightDir, 'groups'), { recursive: true });
  mkdirSync(join(hindsightDir, 'users'), { recursive: true });

  // Generate config.json5 (extract from inline plugin config)
  const config: Record<string, any> = {};
  for (const field of CONFIG_FIELDS) {
    if ((pluginConfig as any)[field] !== undefined) {
      config[field] = (pluginConfig as any)[field];
    }
  }
  writeJson5File(join(hindsightDir, 'config.json5'), config);
  console.log('[hindclaw init] Created config.json5');

  // Generate _default group
  writeJson5File(join(hindsightDir, 'groups', '_default.json5'), {
    displayName: 'Anonymous',
    members: [],
    recall: true,    // safe default: current behavior (all users get full access)
    retain: true,
  });
  console.log('[hindclaw init] Created groups/_default.json5');

  // Generate templates
  writeJson5File(join(hindsightDir, 'groups', '_template.json5'), {
    displayName: 'GROUP_NAME',
    members: [],
    recall: true,
    retain: true,
  });

  writeJson5File(join(hindsightDir, 'users', '_template.json5'), {
    displayName: 'USER_NAME',
    email: '',
    channels: { telegram: '' },
  });

  writeJson5File(join(hindsightDir, 'banks', '_template.json5'), {
    bank_id: 'AGENT_ID',
    retain_mission: '',
    retain: { strategies: {} },
    permissions: {
      groups: { _default: { recall: false, retain: false } },
    },
  });
  console.log('[hindclaw init] Created template files');

  // Migrate existing bank configs if --from-existing
  if (options.fromExisting) {
    const agents = pluginConfig.agents ?? {};
    const banksDir = join(openclawDir, 'banks');

    for (const [agentId, entry] of Object.entries(agents)) {
      const bankConfigPath = (entry as any).bankConfig;
      if (!bankConfigPath) continue;

      const srcPath = join(openclawDir, bankConfigPath);
      if (!existsSync(srcPath)) {
        console.warn(`[hindclaw init] ⚠ Bank config not found: ${srcPath}`);
        continue;
      }

      // Read, transform, write
      const raw = readFileSync(srcPath, 'utf-8');
      let bankConfig: any;
      try {
        bankConfig = JSON5.parse(raw);
      } catch (err: any) {
        console.warn(`[hindclaw init] ⚠ Failed to parse ${srcPath}: ${err.message}`);
        continue;
      }

      // Convert memory → retain.strategies
      if (bankConfig.memory) {
        const strategies: Record<string, any> = {};
        for (const mode of ['full', 'recall', 'disabled']) {
          const modeStrategies = bankConfig.memory[mode];
          if (!modeStrategies) continue;
          if (mode !== 'full') {
            const names = Object.keys(modeStrategies).join(', ');
            console.warn(`[hindclaw init] ⚠ ${agentId}: strategies in "${mode}" mode dropped: ${names} (use permissions for access control)`);
            continue;
          }
          for (const [stratName, scope] of Object.entries(modeStrategies)) {
            strategies[stratName] = scope;
          }
        }
        if (Object.keys(strategies).length > 0) {
          bankConfig.retain = { strategies };
        }
        delete bankConfig.memory;
      }

      // Add default permissions if not present
      if (!bankConfig.permissions) {
        bankConfig.permissions = {
          groups: { _default: { recall: true, retain: true } },
        };
      }

      const destPath = join(hindsightDir, 'banks', `${agentId}.json5`);
      writeJson5File(destPath, bankConfig);
      console.log(`[hindclaw init] Migrated bank: ${agentId}`);

      // Copy $include subdirectories if they exist
      const agentSubdir = join(banksDir, agentId);
      if (existsSync(agentSubdir)) {
        const destSubdir = join(hindsightDir, 'banks', agentId);
        copyDirRecursive(agentSubdir, destSubdir);
        console.log(`[hindclaw init] Copied $include fragments: banks/${agentId}/`);
      }
    }
  }

  if (options.fromExisting) {
    console.warn('[hindclaw init] ⚠ JSON5 comments are not preserved during migration. Review migrated bank files.');
  }

  console.log(`\n[hindclaw init] ✓ Created ${hindsightDir}`);
  console.log('[hindclaw init] Next steps:');
  console.log('  1. Review migrated bank configs (comments may be lost)');
  console.log('  2. Create user profiles in hindsight/users/');
  console.log('  3. Create groups in hindsight/groups/');
  console.log('  4. Add permissions to bank configs');
  console.log('  5. Update plugins.json5: configPath: "./hindsight"');
}

/** Load plugin config from openclaw.json (resolves $include directives) */
function loadPluginConfigLocal(configPath: string): PluginConfig {
  const config = resolveIncludes(configPath);
  return config?.plugins?.entries?.['hindclaw']?.config
    ?? config?.plugins?.entries?.['hindclaw']?.config
    ?? {};
}

/** Recursively resolve $include directives in a JSON5 config file */
function resolveIncludes(filePath: string): any {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = JSON5.parse(content);
  return resolveIncludesInObject(parsed, dirname(filePath));
}

function resolveIncludesInObject(obj: any, baseDir: string): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => resolveIncludesInObject(item, baseDir));

  // Check if this object is a $include reference
  if (obj['$include'] && typeof obj['$include'] === 'string' && Object.keys(obj).length === 1) {
    const includePath = join(baseDir, obj['$include']);
    if (!existsSync(includePath)) {
      console.warn(`[hindclaw init] ⚠ $include not found: ${includePath}`);
      return {};
    }
    return resolveIncludes(includePath);
  }

  // Recurse into all values
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$include' && typeof value === 'string') {
      // Top-level $include (merge into parent)
      const includePath = join(baseDir, value);
      if (existsSync(includePath)) {
        const included = resolveIncludes(includePath);
        if (typeof included === 'object' && !Array.isArray(included)) {
          Object.assign(result, included);
        }
      }
    } else {
      result[key] = resolveIncludesInObject(value, baseDir);
    }
  }
  return result;
}

function writeJson5File(path: string, data: any): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
