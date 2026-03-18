import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapBank, resetBootstrapState } from './bootstrap.js';
import type { HindsightClient } from '../client.js';
import type { BankConfig } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeClient(overrides: Partial<{
  getBankConfig: ReturnType<typeof vi.fn>;
  updateBankConfig: ReturnType<typeof vi.fn>;
  createDirective: ReturnType<typeof vi.fn>;
  listDirectives: ReturnType<typeof vi.fn>;
}> = {}): HindsightClient {
  return {
    getBankConfig: vi.fn().mockResolvedValue({ overrides: {} }),
    updateBankConfig: vi.fn().mockResolvedValue({}),
    createDirective: vi.fn().mockResolvedValue({}),
    listDirectives: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as HindsightClient;
}

function makeConfig(overrides: Partial<BankConfig> = {}): BankConfig {
  return {
    retain_mission: 'Remember everything.',
    disposition_empathy: 0.8,
    directives: [
      { name: 'style', content: 'Be concise.' },
    ],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('bootstrapBank', () => {
  beforeEach(() => {
    resetBootstrapState();
  });

  // 1. Applies config when bank is empty (overrides = {})
  it('applies config when bank has no overrides', async () => {
    const client = makeClient({
      getBankConfig: vi.fn().mockResolvedValue({ overrides: {} }),
    });
    const config = makeConfig({ directives: [] });

    const result = await bootstrapBank('test-bank', config, client);

    expect(result.applied).toBe(true);
    expect(result.error).toBeUndefined();
    expect(client.updateBankConfig).toHaveBeenCalledOnce();
    expect(client.updateBankConfig).toHaveBeenCalledWith('test-bank', expect.objectContaining({
      retain_mission: 'Remember everything.',
      disposition_empathy: 0.8,
    }));
  });

  // 2. Skips when bank already has overrides
  it('skips when bank already has overrides', async () => {
    const client = makeClient({
      getBankConfig: vi.fn().mockResolvedValue({ overrides: { retain_mission: 'existing' } }),
    });

    const result = await bootstrapBank('test-bank', makeConfig(), client);

    expect(result.applied).toBe(false);
    expect(result.error).toBeUndefined();
    expect(client.updateBankConfig).not.toHaveBeenCalled();
    expect(client.createDirective).not.toHaveBeenCalled();
  });

  // 3. Skips when already bootstrapped in this process (Set tracking)
  it('skips on second call for the same bank (Set tracking)', async () => {
    const client = makeClient({
      getBankConfig: vi.fn().mockResolvedValue({ overrides: {} }),
    });
    const config = makeConfig({ directives: [] });

    await bootstrapBank('my-bank', config, client);
    const result = await bootstrapBank('my-bank', config, client);

    expect(result.applied).toBe(false);
    expect(result.error).toBeUndefined();
    // getBankConfig only called once (second call is skipped before checking)
    expect(client.getBankConfig).toHaveBeenCalledOnce();
  });

  // 4. Creates directives from file
  it('creates directives from bankConfig', async () => {
    const client = makeClient({
      getBankConfig: vi.fn().mockResolvedValue({ overrides: {} }),
    });
    const config = makeConfig({
      directives: [
        { name: 'style', content: 'Be concise.' },
        { name: 'tone', content: 'Be warm.' },
      ],
    });

    const result = await bootstrapBank('test-bank', config, client);

    expect(result.applied).toBe(true);
    expect(client.createDirective).toHaveBeenCalledTimes(2);
    expect(client.createDirective).toHaveBeenCalledWith('test-bank', { name: 'style', content: 'Be concise.' });
    expect(client.createDirective).toHaveBeenCalledWith('test-bank', { name: 'tone', content: 'Be warm.' });
  });

  // 5. Returns error on API failure (doesn't throw)
  it('returns error when updateBankConfig fails without throwing', async () => {
    const client = makeClient({
      getBankConfig: vi.fn().mockResolvedValue({ overrides: {} }),
      updateBankConfig: vi.fn().mockRejectedValue(new Error('Server 500')),
    });

    const result = await bootstrapBank('test-bank', makeConfig({ directives: [] }), client);

    expect(result.applied).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Server 500');
  });

  // 6. Handles getBankConfig failure (returns error)
  it('returns error when getBankConfig fails without throwing', async () => {
    const client = makeClient({
      getBankConfig: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    const result = await bootstrapBank('test-bank', makeConfig(), client);

    expect(result.applied).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Network error');
    expect(client.updateBankConfig).not.toHaveBeenCalled();
  });

  // 7. resetBootstrapState clears the tracking
  it('allows re-bootstrapping after resetBootstrapState', async () => {
    const client = makeClient({
      getBankConfig: vi.fn().mockResolvedValue({ overrides: {} }),
    });
    const config = makeConfig({ directives: [] });

    await bootstrapBank('my-bank', config, client);
    resetBootstrapState();
    const result = await bootstrapBank('my-bank', config, client);

    expect(result.applied).toBe(true);
    expect(client.getBankConfig).toHaveBeenCalledTimes(2);
  });

  // 8. Only applies fields that are defined in the config
  it('only includes defined fields in updateBankConfig payload', async () => {
    const client = makeClient({
      getBankConfig: vi.fn().mockResolvedValue({ overrides: {} }),
    });
    const config: BankConfig = {
      retain_mission: 'Remember.',
      // disposition_empathy, observations_mission, etc. are NOT set
      directives: [],
    };

    await bootstrapBank('test-bank', config, client);

    const payload = (client.updateBankConfig as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(payload).toHaveProperty('retain_mission');
    expect(payload).not.toHaveProperty('disposition_empathy');
    expect(payload).not.toHaveProperty('observations_mission');
  });

  // 9. No updateBankConfig call when config has no known fields
  it('skips updateBankConfig when no config fields are set', async () => {
    const client = makeClient({
      getBankConfig: vi.fn().mockResolvedValue({ overrides: {} }),
    });
    const config: BankConfig = { directives: [] };

    const result = await bootstrapBank('test-bank', config, client);

    expect(result.applied).toBe(true);
    expect(client.updateBankConfig).not.toHaveBeenCalled();
  });
});
