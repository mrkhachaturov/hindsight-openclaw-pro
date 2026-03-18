import { describe, it, expect, beforeAll } from 'vitest';
import { HindsightClient } from '../../src/client.js';
import { planBank } from '../../src/sync/plan.js';
import { applyBank } from '../../src/sync/apply.js';
import { importBank } from '../../src/sync/import.js';
import { bootstrapBank, resetBootstrapState } from '../../src/sync/bootstrap.js';
import type { BankConfig } from '../../src/types.js';

const API_URL = process.env.HINDSIGHT_API_URL || 'http://localhost:8888';
const API_TOKEN = process.env.HINDSIGHT_API_TOKEN;

const TEST_BANK_ID = `test-integration-${Date.now()}`;

const testBankConfig: BankConfig = {
  retain_mission: 'Integration test mission',
  disposition_skepticism: 3,
  disposition_literalism: 3,
  disposition_empathy: 3,
  directives: [
    { name: 'test-rule', content: 'This is a test directive' },
  ],
};

describe('Sync Integration', () => {
  let client: HindsightClient;

  beforeAll(() => {
    client = new HindsightClient({ apiUrl: API_URL, apiToken: API_TOKEN });
  });

  it('bootstrap applies config to empty bank', async () => {
    resetBootstrapState();
    const result = await bootstrapBank(TEST_BANK_ID, testBankConfig, client);
    expect(result.applied).toBe(true);
  });

  it('plan shows no changes after bootstrap', async () => {
    const plan = await planBank('test-agent', TEST_BANK_ID, testBankConfig, client);
    expect(plan.hasChanges).toBe(false);
  });

  it('plan detects changes after modifying config', async () => {
    const modifiedConfig = { ...testBankConfig, retain_mission: 'Updated mission' };
    const plan = await planBank('test-agent', TEST_BANK_ID, modifiedConfig, client);
    expect(plan.hasChanges).toBe(true);
    expect(plan.configChanges.find(c => c.field === 'retain_mission')?.action).toBe('change');
  });

  it('apply updates the bank', async () => {
    const modifiedConfig = { ...testBankConfig, retain_mission: 'Updated mission' };
    const plan = await planBank('test-agent', TEST_BANK_ID, modifiedConfig, client);
    const result = await applyBank(plan, client);
    expect(result.configUpdated).toBe(true);
  });

  it('import pulls current state', async () => {
    const result = await importBank(TEST_BANK_ID, client);
    expect(result.bankConfig.retain_mission).toBe('Updated mission');
    expect(result.stats.directives).toBe(1);
  });
});
