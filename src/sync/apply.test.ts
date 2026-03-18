import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyBank } from './apply.js';
import type { BankPlan } from './plan.js';
import type { HindsightClient } from '../client.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeClient(): {
  updateBankConfig: ReturnType<typeof vi.fn>;
  createDirective: ReturnType<typeof vi.fn>;
  updateDirective: ReturnType<typeof vi.fn>;
  deleteDirective: ReturnType<typeof vi.fn>;
} & HindsightClient {
  return {
    updateBankConfig: vi.fn().mockResolvedValue({}),
    createDirective: vi.fn().mockResolvedValue({}),
    updateDirective: vi.fn().mockResolvedValue({}),
    deleteDirective: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof makeClient>;
}

function makePlan(overrides: Partial<BankPlan> = {}): BankPlan {
  return {
    bankId: 'test-bank',
    agentId: 'yoda',
    configChanges: [],
    directiveChanges: [],
    hasChanges: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('applyBank', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
  });

  // 1. No changes — returns immediately, no API calls
  it('returns immediately with no API calls when hasChanges is false', async () => {
    const plan = makePlan({ hasChanges: false });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    expect(result.configUpdated).toBe(false);
    expect(result.directivesCreated).toBe(0);
    expect(result.directivesUpdated).toBe(0);
    expect(result.directivesDeleted).toBe(0);
    expect(result.errors).toEqual([]);
    expect(client.updateBankConfig).not.toHaveBeenCalled();
    expect(client.createDirective).not.toHaveBeenCalled();
    expect(client.updateDirective).not.toHaveBeenCalled();
    expect(client.deleteDirective).not.toHaveBeenCalled();
  });

  // 2. Config changes — calls updateBankConfig with merged updates
  it('calls updateBankConfig with merged add and change fields', async () => {
    const plan = makePlan({
      configChanges: [
        { field: 'retain_mission', action: 'add', newValue: 'Remember everything.' },
        { field: 'disposition_empathy', action: 'change', oldValue: 0.5, newValue: 0.9 },
        { field: 'observations_mission', action: 'remove', oldValue: 'Old obs.' },
      ],
    });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    expect(client.updateBankConfig).toHaveBeenCalledOnce();
    expect(client.updateBankConfig).toHaveBeenCalledWith('test-bank', {
      retain_mission: 'Remember everything.',
      disposition_empathy: 0.9,
    });
    expect(result.configUpdated).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // 3. Directive create — calls createDirective with name + content
  it('calls createDirective with name and content', async () => {
    const plan = makePlan({
      directiveChanges: [
        { name: 'style', action: 'create', content: 'Be concise.' },
      ],
    });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    expect(client.createDirective).toHaveBeenCalledOnce();
    expect(client.createDirective).toHaveBeenCalledWith('test-bank', {
      name: 'style',
      content: 'Be concise.',
    });
    expect(result.directivesCreated).toBe(1);
    expect(result.errors).toEqual([]);
  });

  // 4. Directive update — calls updateDirective with serverId + content
  it('calls updateDirective with serverId and content', async () => {
    const plan = makePlan({
      directiveChanges: [
        { name: 'style', action: 'update', serverId: 'dir-abc', content: 'Updated content.' },
      ],
    });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    expect(client.updateDirective).toHaveBeenCalledOnce();
    expect(client.updateDirective).toHaveBeenCalledWith('test-bank', 'dir-abc', {
      content: 'Updated content.',
    });
    expect(result.directivesUpdated).toBe(1);
    expect(result.errors).toEqual([]);
  });

  // 5. Directive delete — calls deleteDirective with serverId
  it('calls deleteDirective with serverId', async () => {
    const plan = makePlan({
      directiveChanges: [
        { name: 'old-style', action: 'delete', serverId: 'dir-xyz' },
      ],
    });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    expect(client.deleteDirective).toHaveBeenCalledOnce();
    expect(client.deleteDirective).toHaveBeenCalledWith('test-bank', 'dir-xyz');
    expect(result.directivesDeleted).toBe(1);
    expect(result.errors).toEqual([]);
  });

  // 6. Mixed changes — config + directives all applied
  it('applies config and directive changes together', async () => {
    const plan = makePlan({
      configChanges: [
        { field: 'retain_mission', action: 'change', oldValue: 'Old.', newValue: 'New.' },
      ],
      directiveChanges: [
        { name: 'new-dir', action: 'create', content: 'Fresh.' },
        { name: 'existing', action: 'update', serverId: 'dir-1', content: 'Updated.' },
        { name: 'gone', action: 'delete', serverId: 'dir-2' },
      ],
    });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    expect(result.configUpdated).toBe(true);
    expect(result.directivesCreated).toBe(1);
    expect(result.directivesUpdated).toBe(1);
    expect(result.directivesDeleted).toBe(1);
    expect(result.errors).toEqual([]);
    expect(client.updateBankConfig).toHaveBeenCalledOnce();
    expect(client.createDirective).toHaveBeenCalledOnce();
    expect(client.updateDirective).toHaveBeenCalledOnce();
    expect(client.deleteDirective).toHaveBeenCalledOnce();
  });

  // 7. Config error — logs error, continues with directives
  it('records config error and continues with directive changes', async () => {
    client.updateBankConfig.mockRejectedValue(new Error('Server 500'));
    const plan = makePlan({
      configChanges: [
        { field: 'retain_mission', action: 'add', newValue: 'Mission.' },
      ],
      directiveChanges: [
        { name: 'style', action: 'create', content: 'Be brief.' },
      ],
    });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    expect(result.configUpdated).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Config update failed');
    expect(result.errors[0]).toContain('Server 500');
    // Directive operations still proceed
    expect(client.createDirective).toHaveBeenCalledOnce();
    expect(result.directivesCreated).toBe(1);
  });

  // 8. Directive error — logs error, continues with remaining directives
  it('records directive error and continues with remaining directives', async () => {
    client.createDirective
      .mockRejectedValueOnce(new Error('Conflict'))
      .mockResolvedValueOnce({});
    const plan = makePlan({
      directiveChanges: [
        { name: 'failing', action: 'create', content: 'This fails.' },
        { name: 'succeeds', action: 'create', content: 'This works.' },
      ],
    });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    expect(result.directivesCreated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Directive create 'failing' failed");
    expect(result.errors[0]).toContain('Conflict');
    expect(client.createDirective).toHaveBeenCalledTimes(2);
  });

  // 9. Only 'add' and 'change' config actions send updates (not 'remove')
  it('does not include remove actions in updateBankConfig payload', async () => {
    const plan = makePlan({
      configChanges: [
        { field: 'retain_mission', action: 'remove', oldValue: 'Old mission.' },
      ],
    });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    // updateBankConfig should not be called since there are no add/change fields
    expect(client.updateBankConfig).not.toHaveBeenCalled();
    expect(result.configUpdated).toBe(false);
    expect(result.errors).toEqual([]);
  });

  // 10. Result contains correct bankId and agentId
  it('returns correct bankId and agentId in result', async () => {
    const plan = makePlan({ bankId: 'my-bank', agentId: 'r2d2' });

    const result = await applyBank(plan, client as unknown as HindsightClient);

    expect(result.bankId).toBe('my-bank');
    expect(result.agentId).toBe('r2d2');
  });
});
