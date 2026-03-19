import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import JSON5 from 'json5';
import type {
  BankConfig,
  PluginConfig,
  ResolvedConfig,
  ServerConfig,
  AgentEntry,
} from './types.js';
import { debug } from './debug.js';

// ── Field classification sets ─────────────────────────────────────────

const SERVER_SIDE_FIELDS = new Set<string>([
  'retain_mission',
  'observations_mission',
  'reflect_mission',
  'retain_extraction_mode',
  'disposition_skepticism',
  'disposition_literalism',
  'disposition_empathy',
  'entity_labels',
  'directives',
  'retain_strategies',
  'retain_default_strategy',
  'retain_chunk_size',
]);

const EXTRACTED_FIELDS = new Set<string>([
  'recallFrom',
  'sessionStartModels',
  'reflectOnRecall',
  'reflectBudget',
  'reflectMaxTokens',
  'memory',
  'retain',
]);

// ── $include resolution ───────────────────────────────────────────────

const MAX_INCLUDE_DEPTH = 10;

/**
 * Recursively resolve $include directives in a parsed config object.
 * Each { "$include": "./path" } is replaced with the parsed contents of the referenced file.
 * Paths are resolved relative to basePath.
 */
export function resolveIncludes<T>(obj: T, basePath: string, depth = 0, seen = new Set<string>()): T {
  if (depth > MAX_INCLUDE_DEPTH) {
    throw new Error(`$include depth exceeded (max ${MAX_INCLUDE_DEPTH})`);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const record = obj as Record<string, unknown>;

  // Check if this object IS an $include directive
  if ('$include' in record && typeof record.$include === 'string' && Object.keys(record).length === 1) {
    const includePath = record.$include as string;
    const filePath = includePath.startsWith('/') ? includePath : join(basePath, includePath);
    if (seen.has(filePath)) {
      throw new Error(`Circular $include detected: ${filePath}`);
    }
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON5.parse(content);
    const nextSeen = new Set(seen);
    nextSeen.add(filePath);
    return resolveIncludes(parsed, dirname(filePath), depth + 1, nextSeen) as T;
  }

  // Walk child properties
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = resolveIncludes(value, basePath, depth, seen);
  }
  return result as T;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Parse a JSON5 bank config file content into a BankConfig object.
 */
export function parseBankConfigFile(content: string): BankConfig {
  return JSON5.parse(content) as BankConfig;
}

/**
 * Resolve per-agent config by merging plugin defaults with bank config overrides.
 *
 * Resolution order: pluginDefaults → bankFile (shallow merge, bank file wins).
 *
 * Server-side fields are extracted into _serverConfig.
 * Extracted behavioral fields (recallFrom, sessionStartModels, reflect*) are
 * hoisted to their underscore-prefixed counterparts.
 * Everything else is merged as behavioral/infrastructure overrides.
 */
export function resolveAgentConfig(
  agentId: string,
  pluginDefaults: Omit<PluginConfig, 'agents' | 'bootstrap'>,
  bankConfigs: Map<string, BankConfig>,
): ResolvedConfig {
  const bankConfig = bankConfigs.get(agentId);

  if (!bankConfig) {
    debug(`[Hindsight] No bank config for agent "${agentId}" — using plugin defaults`);
    return {
      ...pluginDefaults,
      _serverConfig: null,
    } as ResolvedConfig;
  }

  // Separate fields from bankConfig
  const serverConfig: Partial<ServerConfig> = {};
  const overrides: Partial<BankConfig> = {};
  let hasServerFields = false;

  for (const [key, value] of Object.entries(bankConfig)) {
    if (SERVER_SIDE_FIELDS.has(key)) {
      (serverConfig as Record<string, unknown>)[key] = value;
      hasServerFields = true;
    } else if (!EXTRACTED_FIELDS.has(key)) {
      (overrides as Record<string, unknown>)[key] = value;
    }
  }

  // Build the merged behavioral/infrastructure config
  const merged: ResolvedConfig = {
    ...pluginDefaults,
    ...overrides,
    _serverConfig: hasServerFields ? (serverConfig as ServerConfig) : null,
  };

  // Hoist extracted fields
  if (bankConfig.recallFrom !== undefined) {
    merged._recallFrom = bankConfig.recallFrom;
  }
  if (bankConfig.sessionStartModels !== undefined) {
    merged._sessionStartModels = bankConfig.sessionStartModels;
  }
  if (bankConfig.reflectOnRecall !== undefined) {
    merged._reflectOnRecall = bankConfig.reflectOnRecall;
  }
  if (bankConfig.reflectBudget !== undefined) {
    merged._reflectBudget = bankConfig.reflectBudget;
  }
  if (bankConfig.reflectMaxTokens !== undefined) {
    merged._reflectMaxTokens = bankConfig.reflectMaxTokens;
  }

  // Hoist retain/memory routing → _topicIndex + _defaultMode
  const retainRouting = bankConfig.retain?.strategies;
  const memoryRouting = bankConfig.memory;
  const topicIndex = new Map<string, { strategy: string; mode: 'full' | 'recall' | 'disabled' }>();

  if (retainRouting) {
    // v2.0.0: flat strategy map — permissions handle access, default mode is always 'full'
    merged._defaultMode = 'full';
    for (const [strategyName, scope] of Object.entries(retainRouting)) {
      if (scope?.topics) {
        for (const topicId of scope.topics) {
          topicIndex.set(String(topicId), { strategy: strategyName, mode: 'full' });
        }
      }
    }
  } else if (memoryRouting) {
    // v1.1.0 fallback: mode bucket format
    merged._defaultMode = memoryRouting.default;
    for (const mode of ['full', 'recall', 'disabled'] as const) {
      const strategies = memoryRouting[mode];
      if (!strategies) continue;
      for (const [name, scopes] of Object.entries(strategies)) {
        for (const topicId of scopes.topics ?? []) {
          topicIndex.set(String(topicId), { strategy: name, mode });
        }
      }
    }
  }

  if (topicIndex.size > 0) {
    merged._topicIndex = topicIndex;
  }

  return merged;
}

/**
 * Load all bank config files for the given agents map.
 * Reads files synchronously — called at plugin init time, not in the hot path.
 *
 * @param agents  Record<agentId, AgentEntry> from PluginConfig.agents
 * @param basePath  Base directory to resolve relative bankConfig paths against
 * @returns Map<agentId, BankConfig>
 */
export function loadBankConfigFiles(
  agents: Record<string, AgentEntry>,
  basePath: string,
): Map<string, BankConfig> {
  const result = new Map<string, BankConfig>();

  for (const [agentId, entry] of Object.entries(agents)) {
    if (!entry?.bankConfig) {
      console.warn(`[Hindsight] Agent "${agentId}" has no bankConfig path — skipping`);
      continue;
    }

    const filePath = entry.bankConfig.startsWith('/')
      ? entry.bankConfig
      : join(basePath, entry.bankConfig);

    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseBankConfigFile(content);
      const resolved = resolveIncludes(parsed, dirname(filePath));
      result.set(agentId, resolved);
      debug(`[Hindsight] Loaded bank config for agent "${agentId}" from ${filePath}`);
    } catch (error) {
      console.warn(`[Hindsight] Failed to load bank config for agent "${agentId}" from ${filePath}:`, error instanceof Error ? error.message : error);
    }
  }

  return result;
}
