import type { HindsightClient } from '../client.js';
import type { BankConfig } from '../types.js';

const bootstrappedBanks = new Set<string>();

const CONFIG_FIELDS = [
  'retain_mission',
  'observations_mission',
  'reflect_mission',
  'retain_extraction_mode',
  'disposition_skepticism',
  'disposition_literalism',
  'disposition_empathy',
  'entity_labels',
] as const;

export async function bootstrapBank(
  bankId: string,
  bankConfig: BankConfig,
  client: HindsightClient,
): Promise<{ applied: boolean; error?: string }> {
  // Skip if already bootstrapped in this process
  if (bootstrappedBanks.has(bankId)) {
    return { applied: false };
  }

  try {
    // Check if bank already has config
    const serverConfig = await client.getBankConfig(bankId);
    const overrides = serverConfig.overrides ?? {};

    if (Object.keys(overrides).length > 0) {
      // Bank already configured — skip
      bootstrappedBanks.add(bankId);
      return { applied: false };
    }

    // Bank is empty — apply config from file
    const configUpdates: Record<string, unknown> = {};

    for (const field of CONFIG_FIELDS) {
      const value = bankConfig[field as keyof BankConfig];
      if (value !== undefined) {
        configUpdates[field] = value;
      }
    }

    if (Object.keys(configUpdates).length > 0) {
      await client.updateBankConfig(bankId, configUpdates);
    }

    // Create directives
    for (const directive of bankConfig.directives ?? []) {
      await client.createDirective(bankId, { name: directive.name, content: directive.content });
    }

    bootstrappedBanks.add(bankId);
    return { applied: true };
  } catch (err) {
    return { applied: false, error: String(err) };
  }
}

// For testing — reset the tracking set
export function resetBootstrapState(): void {
  bootstrappedBanks.clear();
}
