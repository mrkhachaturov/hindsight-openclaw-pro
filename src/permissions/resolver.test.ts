import { describe, it, expect } from 'vitest';
import { resolvePermissions } from './resolver.js';
import type { GroupConfig, UserProfile, DiscoveryResult } from './types.js';

/** Helper to build a minimal DiscoveryResult for testing */
function buildTestDiscovery(overrides?: {
  users?: Record<string, UserProfile>;
  groups?: Record<string, GroupConfig>;
  banks?: Record<string, any>;
}): DiscoveryResult {
  const users = new Map(Object.entries(overrides?.users ?? {
    ruben: { displayName: 'Ruben', channels: { telegram: '123456' } },
    vagan: { displayName: 'Vagan', channels: { telegram: '789012' } },
    petya: { displayName: 'Petya', channels: { telegram: '345678' } },
  }));

  const groups = new Map(Object.entries(overrides?.groups ?? {
    _default: { displayName: 'Anonymous', members: [], recall: false, retain: false },
    executive: {
      displayName: 'Executive', members: ['ruben'],
      recall: true, retain: true,
      retainRoles: ['user', 'assistant', 'tool'],
      retainTags: ['role:executive'],
      recallBudget: 'high' as const, recallMaxTokens: 2048,
      recallTagGroups: null, llmModel: 'claude-sonnet-4-5',
    },
    'dept-head': {
      displayName: 'Dept Head', members: ['vagan'],
      recall: true, retain: true,
      retainRoles: ['user', 'assistant'],
      retainTags: ['role:dept-head'],
      recallBudget: 'mid' as const, recallMaxTokens: 1024,
      recallTagGroups: [{ not: { tags: ['sensitivity:restricted'], match: 'any_strict' as const } }],
    },
    staff: {
      displayName: 'Staff', members: ['petya'],
      recall: true, retain: true,
      retainRoles: ['assistant'],
      retainTags: ['role:staff'],
      recallBudget: 'low' as const, recallMaxTokens: 512,
    },
    motors: {
      displayName: 'Motors', members: ['vagan', 'petya'],
      recallTagGroups: [{ tags: ['department:motors'], match: 'any' as const }],
      retainTags: ['department:motors'],
    },
  }));

  const banks = new Map(Object.entries(overrides?.banks ?? {
    yoda: {
      bank_id: 'yoda',
      permissions: {
        groups: {
          executive: { recall: true, retain: true },
          'dept-head': { recall: true, retain: false },
          _default: { recall: false, retain: false },
        },
      },
    },
    r4p17: {
      bank_id: 'r4p17',
      permissions: {
        groups: {
          executive: { recall: true, retain: true },
          'dept-head': { recall: true, retain: true },
          staff: { recall: true, retain: false },
          _default: { recall: false, retain: false },
        },
        users: {
          vagan: { recallBudget: 'high' as const, recallMaxTokens: 2048 },
        },
      },
    },
  }));

  // Build indexes
  const channelIndex = new Map<string, string>();
  for (const [id, profile] of users) {
    for (const [provider, senderId] of Object.entries(profile.channels)) {
      channelIndex.set(`${provider}:${senderId}`, id);
    }
  }

  const membershipIndex = new Map<string, string[]>();
  for (const [groupName, config] of groups) {
    if (groupName === '_default') continue;
    for (const member of config.members) {
      const existing = membershipIndex.get(member) ?? [];
      existing.push(groupName);
      membershipIndex.set(member, existing.sort());
    }
  }

  return { banks, groups, users, channelIndex, membershipIndex, strategyIndex: new Map() };
}

describe('resolvePermissions', () => {
  const discovery = buildTestDiscovery();

  describe('Scenario A: Ruben (executive) on Yoda', () => {
    it('gets full access with no tag filter', () => {
      const result = resolvePermissions('telegram:123456', 'yoda', discovery);
      expect(result.canonicalId).toBe('ruben');
      expect(result.isAnonymous).toBe(false);
      expect(result.recall).toBe(true);
      expect(result.retain).toBe(true);
      expect(result.recallBudget).toBe('high');
      expect(result.recallMaxTokens).toBe(2048);
      expect(result.recallTagGroups).toBeNull();
      expect(result.retainTags).toContain('role:executive');
      expect(result.retainTags).toContain('user:ruben');
    });
  });

  describe('Scenario B: Vagan (dept-head+motors) on Yoda', () => {
    it('gets recall only (bank overrides retain to false)', () => {
      const result = resolvePermissions('telegram:789012', 'yoda', discovery);
      expect(result.canonicalId).toBe('vagan');
      expect(result.recall).toBe(true);
      expect(result.retain).toBe(false);  // bank-level dept-head override
      expect(result.recallBudget).toBe('mid');
      expect(result.recallTagGroups).toHaveLength(2);  // NOT restricted + dept:motors
      expect(result.retainTags).toContain('role:dept-head');
      expect(result.retainTags).toContain('department:motors');
      expect(result.retainTags).toContain('user:vagan');
    });
  });

  describe('Scenario C: Petya (staff+motors) on Yoda', () => {
    it('gets _default (no staff entry on Yoda bank)', () => {
      const result = resolvePermissions('telegram:345678', 'yoda', discovery);
      expect(result.canonicalId).toBe('petya');
      expect(result.recall).toBe(false);
      expect(result.retain).toBe(false);
    });
  });

  describe('Scenario D: Anonymous on Yoda', () => {
    it('gets bank _default (no access)', () => {
      const result = resolvePermissions('telegram:999999', 'yoda', discovery);
      expect(result.canonicalId).toBeNull();
      expect(result.isAnonymous).toBe(true);
      expect(result.recall).toBe(false);
      expect(result.retain).toBe(false);
      expect(result.displayName).toBe('Anonymous');
    });
  });

  describe('Scenario E: Vagan on R4P17 with user override', () => {
    it('gets bank user override for budget + tokens', () => {
      const result = resolvePermissions('telegram:789012', 'r4p17', discovery);
      expect(result.recall).toBe(true);
      expect(result.retain).toBe(true);  // r4p17 grants retain for dept-head
      expect(result.recallBudget).toBe('high');      // user override
      expect(result.recallMaxTokens).toBe(2048);     // user override
      expect(result.retainTags).toContain('department:motors');
      expect(result.retainTags).toContain('user:vagan');
    });
  });

  describe('Bank without permissions', () => {
    it('falls through to global group defaults', () => {
      const d = buildTestDiscovery({
        banks: { bb8: { bank_id: 'bb8' } },  // no permissions key
      });
      // Ruben should get global executive defaults
      const result = resolvePermissions('telegram:123456', 'bb8', d);
      expect(result.recall).toBe(true);
      expect(result.retain).toBe(true);
      expect(result.recallBudget).toBe('high');
    });
  });

  describe('Known user in zero groups', () => {
    it('falls to _default group', () => {
      const d = buildTestDiscovery({
        users: { orphan: { displayName: 'Orphan', channels: { telegram: '111111' } } },
        groups: {
          _default: { displayName: 'Anonymous', members: [], recall: false, retain: false },
        },
        banks: { yoda: { bank_id: 'yoda' } },
      });
      const result = resolvePermissions('telegram:111111', 'yoda', d);
      expect(result.canonicalId).toBe('orphan');
      expect(result.isAnonymous).toBe(false);  // known user, just ungrouped
      expect(result.recall).toBe(false);
      expect(result.retain).toBe(false);
    });
  });

  describe('Auto-generated user tag', () => {
    it('adds user:<id> tag for known users', () => {
      const result = resolvePermissions('telegram:123456', 'yoda', discovery);
      expect(result.retainTags).toContain('user:ruben');
    });

    it('does not add user tag for anonymous', () => {
      const result = resolvePermissions('telegram:999999', 'yoda', discovery);
      expect(result.retainTags.some(t => t.startsWith('user:'))).toBe(false);
    });
  });
});
