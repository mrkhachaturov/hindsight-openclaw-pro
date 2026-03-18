import type { HindsightClient } from '../client.js';
import type { BankConfig, BankConfigDirective } from '../types.js';

// Config fields we import from server overrides
const IMPORTABLE_CONFIG_FIELDS = [
  'retain_mission', 'observations_mission', 'reflect_mission',
  'retain_extraction_mode', 'disposition_skepticism', 'disposition_literalism',
  'disposition_empathy', 'entity_labels',
] as const;

export interface ImportResult {
  bankConfig: BankConfig;
  stats: {
    configFields: number;
    directives: number;
  };
}

export async function importBank(
  bankId: string,
  client: HindsightClient,
): Promise<ImportResult> {
  // 1. Get bank config (overrides only — what was explicitly set)
  const serverConfig = await client.getBankConfig(bankId);
  const overrides = serverConfig.overrides ?? {};

  // 2. Get directives
  const serverDirectives = await client.listDirectives(bankId).catch(() => []);

  // 3. Assemble BankConfig
  const bankConfig: Record<string, unknown> = {};

  let configFields = 0;
  for (const field of IMPORTABLE_CONFIG_FIELDS) {
    if (overrides[field] !== undefined) {
      bankConfig[field] = overrides[field];
      configFields++;
    }
  }

  // Convert directives to file format (name + content only, no server IDs)
  if (serverDirectives.length > 0) {
    bankConfig.directives = serverDirectives.map(d => ({
      name: d.name,
      content: d.content,
    }));
  }

  return {
    bankConfig: bankConfig as BankConfig,
    stats: {
      configFields,
      directives: serverDirectives.length,
    },
  };
}

export function formatBankConfigAsJson5(bankConfig: BankConfig): string {
  // Pretty-print as JSON5-compatible (standard JSON with comments indicating sections)
  return JSON.stringify(bankConfig, null, 2);
}
