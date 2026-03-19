import { describe, it, expect } from 'vitest';
import { mergeGroups, overlayFields } from './merge.js';
import type { PermissionOverride } from './types.js';

describe('mergeGroups', () => {
  it('single group returns its fields unchanged', () => {
    const group: PermissionOverride = {
      recall: true,
      retain: false,
      recallBudget: 'mid',
      recallMaxTokens: 1024,
      retainRoles: ['user', 'assistant'],
      retainTags: ['role:dept-head'],
    };
    const result = mergeGroups([group]);
    expect(result.recall).toBe(true);
    expect(result.retain).toBe(false);
    expect(result.recallBudget).toBe('mid');
    expect(result.recallMaxTokens).toBe(1024);
    expect(result.retainRoles).toEqual(['user', 'assistant']);
    expect(result.retainTags).toEqual(['role:dept-head']);
  });

  it('recall/retain: most permissive wins (true > false)', () => {
    const result = mergeGroups([
      { recall: false, retain: false },
      { recall: true, retain: false },
    ]);
    expect(result.recall).toBe(true);
    expect(result.retain).toBe(false);
  });

  it('recallBudget: most permissive wins (high > mid > low)', () => {
    const result = mergeGroups([
      { recallBudget: 'low' },
      { recallBudget: 'high' },
      { recallBudget: 'mid' },
    ]);
    expect(result.recallBudget).toBe('high');
  });

  it('recallMaxTokens: highest value wins', () => {
    const result = mergeGroups([
      { recallMaxTokens: 512 },
      { recallMaxTokens: 2048 },
      { recallMaxTokens: 1024 },
    ]);
    expect(result.recallMaxTokens).toBe(2048);
  });

  it('retainRoles: unioned and deduplicated', () => {
    const result = mergeGroups([
      { retainRoles: ['user', 'assistant'] },
      { retainRoles: ['assistant', 'tool'] },
    ]);
    expect(result.retainRoles?.sort()).toEqual(['assistant', 'tool', 'user']);
  });

  it('retainTags: unioned and deduplicated', () => {
    const result = mergeGroups([
      { retainTags: ['role:dept-head'] },
      { retainTags: ['department:motors', 'role:dept-head'] },
    ]);
    expect(result.retainTags?.sort()).toEqual(['department:motors', 'role:dept-head']);
  });

  it('excludeProviders: unioned (deny list)', () => {
    const result = mergeGroups([
      { excludeProviders: ['slack'] },
      { excludeProviders: ['discord', 'slack'] },
    ]);
    expect(result.excludeProviders?.sort()).toEqual(['discord', 'slack']);
  });

  it('recallTagGroups: AND-ed together', () => {
    const result = mergeGroups([
      { recallTagGroups: [{ tags: ['dept:motors'], match: 'any' as const }] },
      { recallTagGroups: [{ not: { tags: ['sensitivity:restricted'], match: 'any_strict' as const } }] },
    ]);
    // Both filters should be present (AND = array concatenation)
    expect(result.recallTagGroups).toHaveLength(2);
  });

  it('recallTagGroups: null is identity element (null AND X = X)', () => {
    const filter = [{ tags: ['dept:motors'], match: 'any' as const }];
    const result = mergeGroups([
      { recallTagGroups: null },
      { recallTagGroups: filter },
    ]);
    expect(result.recallTagGroups).toEqual(filter);
  });

  it('recallTagGroups: null AND null = null', () => {
    const result = mergeGroups([
      { recallTagGroups: null },
      { recallTagGroups: null },
    ]);
    expect(result.recallTagGroups).toBeNull();
  });

  it('recallTagGroups: all undefined returns undefined', () => {
    const result = mergeGroups([{}, {}]);
    expect(result.recallTagGroups).toBeUndefined();
  });

  it('recallTagGroups: undefined groups are skipped', () => {
    const filter = [{ tags: ['dept:motors'], match: 'any' as const }];
    const result = mergeGroups([
      {},  // no recallTagGroups defined
      { recallTagGroups: filter },
    ]);
    expect(result.recallTagGroups).toEqual(filter);
  });

  it('llmModel: alphabetically first group that defines it wins', () => {
    // Groups are passed in alphabetical order by the caller
    const result = mergeGroups([
      { llmModel: 'claude-opus' },        // group "a-executive"
      { llmModel: 'gpt-4o-mini' },        // group "b-staff"
    ]);
    expect(result.llmModel).toBe('claude-opus');
  });

  it('retainEveryNTurns: lowest value wins (most frequent)', () => {
    const result = mergeGroups([
      { retainEveryNTurns: 3 },
      { retainEveryNTurns: 1 },
    ]);
    expect(result.retainEveryNTurns).toBe(1);
  });

  it('empty array returns empty override', () => {
    const result = mergeGroups([]);
    expect(result.recall).toBeUndefined();
    expect(result.retain).toBeUndefined();
  });

  it('full scenario: dept-head + motors merge', () => {
    const deptHead: PermissionOverride = {
      recall: true,
      retain: true,
      retainRoles: ['user', 'assistant'],
      retainTags: ['role:dept-head'],
      recallBudget: 'mid',
      recallMaxTokens: 1024,
      recallTagGroups: [{ not: { tags: ['sensitivity:restricted'], match: 'any_strict' as const } }],
    };
    const motors: PermissionOverride = {
      recallTagGroups: [{ tags: ['department:motors'], match: 'any' as const }],
      retainTags: ['department:motors'],
    };
    const result = mergeGroups([deptHead, motors]);
    expect(result.recall).toBe(true);
    expect(result.retain).toBe(true);
    expect(result.retainRoles).toEqual(['user', 'assistant']);
    expect(result.retainTags?.sort()).toEqual(['department:motors', 'role:dept-head']);
    expect(result.recallBudget).toBe('mid');
    expect(result.recallMaxTokens).toBe(1024);
    expect(result.recallTagGroups).toHaveLength(2);
  });
});

describe('overlayFields', () => {
  it('overlay replaces defined fields in base', () => {
    const base: PermissionOverride = { recall: false, retain: false, recallBudget: 'low' };
    const overlay: PermissionOverride = { recall: true };
    const result = overlayFields(base, overlay);
    expect(result.recall).toBe(true);
    expect(result.retain).toBe(false);   // inherited from base
    expect(result.recallBudget).toBe('low');  // inherited from base
  });

  it('overlay undefined fields do not replace base', () => {
    const base: PermissionOverride = { recallBudget: 'high', recallMaxTokens: 2048 };
    const overlay: PermissionOverride = { recallBudget: 'low' };
    const result = overlayFields(base, overlay);
    expect(result.recallBudget).toBe('low');       // replaced
    expect(result.recallMaxTokens).toBe(2048);     // inherited
  });

  it('overlay null recallTagGroups replaces base', () => {
    const base: PermissionOverride = {
      recallTagGroups: [{ tags: ['dept:motors'], match: 'any' }],
    };
    const overlay: PermissionOverride = { recallTagGroups: null };
    const result = overlayFields(base, overlay);
    expect(result.recallTagGroups).toBeNull();
  });

  it('empty overlay returns base unchanged', () => {
    const base: PermissionOverride = { recall: true, retain: true, recallBudget: 'high' };
    const result = overlayFields(base, {});
    expect(result).toEqual(base);
  });

  it('overlay non-null recallTagGroups replaces null base', () => {
    const base: PermissionOverride = { recallTagGroups: null };
    const filter = [{ tags: ['dept:motors'], match: 'any' as const }];
    const overlay: PermissionOverride = { recallTagGroups: filter };
    const result = overlayFields(base, overlay);
    expect(result.recallTagGroups).toEqual(filter);
  });
});
