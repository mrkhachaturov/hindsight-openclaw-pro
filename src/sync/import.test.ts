import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importBank, formatBankConfigAsJson5 } from './import.js';
import type { HindsightClient } from '../client.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeClient(): {
  getBankConfig: ReturnType<typeof vi.fn>;
  listDirectives: ReturnType<typeof vi.fn>;
} & HindsightClient {
  return {
    getBankConfig: vi.fn(),
    listDirectives: vi.fn(),
  } as unknown as ReturnType<typeof makeClient>;
}

function makeDirective(overrides: Partial<{
  id: string;
  bank_id: string;
  name: string;
  content: string;
  priority: number;
  is_active: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}> = {}) {
  return {
    id: 'dir-server-id',
    bank_id: 'test-bank',
    name: 'style',
    content: 'Be concise.',
    priority: 0,
    is_active: true,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('importBank', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
  });

  // 1. Imports config fields from server overrides
  it('imports known config fields from server overrides', async () => {
    client.getBankConfig.mockResolvedValue({
      config: {},
      overrides: {
        retain_mission: 'Remember everything.',
        disposition_empathy: 0.8,
        disposition_skepticism: 0.3,
      },
    });
    client.listDirectives.mockResolvedValue([]);

    const result = await importBank('test-bank', client as unknown as HindsightClient);

    expect(result.bankConfig.retain_mission).toBe('Remember everything.');
    expect(result.bankConfig.disposition_empathy).toBe(0.8);
    expect(result.bankConfig.disposition_skepticism).toBe(0.3);
  });

  // 2. Imports directives — strips server IDs, keeps name + content only
  it('imports directives stripping server-only fields', async () => {
    client.getBankConfig.mockResolvedValue({ config: {}, overrides: {} });
    client.listDirectives.mockResolvedValue([
      makeDirective({ id: 'dir-abc', name: 'style', content: 'Be concise.' }),
      makeDirective({ id: 'dir-xyz', name: 'tone', content: 'Stay formal.' }),
    ]);

    const result = await importBank('test-bank', client as unknown as HindsightClient);

    expect(result.bankConfig.directives).toEqual([
      { name: 'style', content: 'Be concise.' },
      { name: 'tone', content: 'Stay formal.' },
    ]);
    // Ensure server-only fields are absent
    for (const d of result.bankConfig.directives!) {
      expect(d).not.toHaveProperty('id');
      expect(d).not.toHaveProperty('bank_id');
      expect(d).not.toHaveProperty('priority');
      expect(d).not.toHaveProperty('is_active');
      expect(d).not.toHaveProperty('tags');
    }
  });

  // 3. Handles empty overrides — returns empty bankConfig (no config fields)
  it('returns empty bankConfig when overrides is empty', async () => {
    client.getBankConfig.mockResolvedValue({ config: {}, overrides: {} });
    client.listDirectives.mockResolvedValue([]);

    const result = await importBank('test-bank', client as unknown as HindsightClient);

    // No config fields set
    const configKeys = Object.keys(result.bankConfig).filter(k => k !== 'directives');
    expect(configKeys).toHaveLength(0);
    // Directives absent when empty
    expect(result.bankConfig.directives).toBeUndefined();
  });

  // 4. Handles listDirectives failure — returns config without directives
  it('returns config without directives when listDirectives fails', async () => {
    client.getBankConfig.mockResolvedValue({
      config: {},
      overrides: { retain_mission: 'Mission text.' },
    });
    client.listDirectives.mockRejectedValue(new Error('Not Found'));

    const result = await importBank('test-bank', client as unknown as HindsightClient);

    expect(result.bankConfig.retain_mission).toBe('Mission text.');
    expect(result.bankConfig.directives).toBeUndefined();
    expect(result.stats.directives).toBe(0);
  });

  // 5. Stats reflect correct counts
  it('stats reflect the number of config fields and directives imported', async () => {
    client.getBankConfig.mockResolvedValue({
      config: {},
      overrides: {
        retain_mission: 'A.',
        observations_mission: 'B.',
        disposition_literalism: 0.5,
      },
    });
    client.listDirectives.mockResolvedValue([
      makeDirective({ name: 'dir1' }),
      makeDirective({ name: 'dir2' }),
    ]);

    const result = await importBank('test-bank', client as unknown as HindsightClient);

    expect(result.stats.configFields).toBe(3);
    expect(result.stats.directives).toBe(2);
  });

  // 6. Only imports known config fields (ignores unknown overrides)
  it('ignores unknown fields present in server overrides', async () => {
    client.getBankConfig.mockResolvedValue({
      config: {},
      overrides: {
        retain_mission: 'Known field.',
        unknown_server_field: 'should be ignored',
        another_unknown: 42,
      },
    });
    client.listDirectives.mockResolvedValue([]);

    const result = await importBank('test-bank', client as unknown as HindsightClient);

    expect(result.bankConfig.retain_mission).toBe('Known field.');
    expect(result.bankConfig).not.toHaveProperty('unknown_server_field');
    expect(result.bankConfig).not.toHaveProperty('another_unknown');
    expect(result.stats.configFields).toBe(1);
  });

  // 7. formatBankConfigAsJson5 produces valid JSON
  it('formatBankConfigAsJson5 returns valid JSON output', async () => {
    const bankConfig = {
      retain_mission: 'Remember.',
      disposition_empathy: 0.9,
      directives: [{ name: 'style', content: 'Be brief.' }],
    };

    const output = formatBankConfigAsJson5(bankConfig);
    const parsed = JSON.parse(output);

    expect(parsed).toEqual(bankConfig);
    expect(output).toContain('"retain_mission"');
    expect(output).toContain('"disposition_empathy"');
    expect(output).toContain('"directives"');
  });
});
