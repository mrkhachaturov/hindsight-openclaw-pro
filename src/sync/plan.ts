import type { HindsightClient } from '../client.js';
import type { BankConfig } from '../types.js';
import { debug } from '../debug.js';

// ── Plan types ───────────────────────────────────────────────────────

export interface ConfigChange {
  field: string;
  action: 'add' | 'change' | 'remove';
  oldValue?: unknown;
  newValue?: unknown;
}

export interface DirectiveChange {
  name: string;
  action: 'create' | 'update' | 'delete';
  serverId?: string;  // server-side ID (for update/delete)
  content?: string;   // new content (for create/update)
}

export interface BankPlan {
  bankId: string;
  agentId: string;
  configChanges: ConfigChange[];
  directiveChanges: DirectiveChange[];
  hasChanges: boolean;
}

// ── Config fields compared server-side (directives handled separately) ──

const CONFIG_FIELDS = [
  'retain_mission',
  'observations_mission',
  'reflect_mission',
  'retain_extraction_mode',
  'disposition_skepticism',
  'disposition_literalism',
  'disposition_empathy',
  'entity_labels',
  'retain_strategies',
  'retain_default_strategy',
  'retain_chunk_size',
] as const;

// ── planBank ─────────────────────────────────────────────────────────

export async function planBank(
  agentId: string,
  bankId: string,
  bankConfig: BankConfig,
  client: HindsightClient,
): Promise<BankPlan> {
  // 1. Get current server config
  debug(`[Hindsight] Plan: fetching config for bank ${bankId}...`);
  let serverOverrides: Record<string, unknown> = {};
  try {
    const serverConfig = await client.getBankConfig(bankId);
    serverOverrides = serverConfig.overrides ?? {};
  } catch (error) {
    console.warn(`[Hindsight] Plan: failed to fetch config for bank ${bankId}:`, error instanceof Error ? error.message : error);
    // Treat as empty — all file fields will appear as 'add'
  }

  // 2. Diff config fields
  const configChanges: ConfigChange[] = [];
  for (const field of CONFIG_FIELDS) {
    const fileValue = bankConfig[field as keyof BankConfig];
    const serverValue = serverOverrides[field];

    if (fileValue !== undefined && serverValue === undefined) {
      configChanges.push({ field, action: 'add', newValue: fileValue });
    } else if (fileValue === undefined && serverValue !== undefined) {
      configChanges.push({ field, action: 'remove', oldValue: serverValue });
    } else if (fileValue !== undefined && serverValue !== undefined) {
      if (JSON.stringify(fileValue) !== JSON.stringify(serverValue)) {
        configChanges.push({ field, action: 'change', oldValue: serverValue, newValue: fileValue });
      }
    }
  }

  // 3. Diff directives
  const directiveChanges: DirectiveChange[] = [];
  const fileDirectives = bankConfig.directives ?? [];
  const serverDirectives = await client.listDirectives(bankId).catch(() => []);

  const serverByName = new Map(serverDirectives.map(d => [d.name, d]));
  const fileNames = new Set(fileDirectives.map(d => d.name));

  // New or changed
  for (const fd of fileDirectives) {
    const sd = serverByName.get(fd.name);
    if (!sd) {
      directiveChanges.push({ name: fd.name, action: 'create', content: fd.content });
    } else if (sd.content !== fd.content) {
      directiveChanges.push({ name: fd.name, action: 'update', serverId: sd.id, content: fd.content });
    }
  }

  // Deleted (on server but not in file)
  for (const sd of serverDirectives) {
    if (!fileNames.has(sd.name)) {
      directiveChanges.push({ name: sd.name, action: 'delete', serverId: sd.id });
    }
  }

  return {
    bankId,
    agentId,
    configChanges,
    directiveChanges,
    hasChanges: configChanges.length > 0 || directiveChanges.length > 0,
  };
}
