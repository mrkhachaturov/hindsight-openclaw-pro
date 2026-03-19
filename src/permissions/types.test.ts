import { describe, it, expect } from 'vitest';
import type {
  UserProfile, GroupConfig, BankPermissions,
  PermissionOverride, ResolvedPermissions, DiscoveryResult, HindsightConfig,
} from './types.js';

describe('permissions/types', () => {
  it('UserProfile has required fields', () => {
    const user: UserProfile = {
      displayName: 'Test User',
      channels: { telegram: '123456' },
    };
    expect(user.displayName).toBe('Test User');
    expect(user.channels.telegram).toBe('123456');
    expect(user.email).toBeUndefined();
  });

  it('GroupConfig has required fields', () => {
    const group: GroupConfig = {
      displayName: 'Test Group',
      members: ['user1', 'user2'],
      recall: true,
      retain: false,
      recallBudget: 'high',
    };
    expect(group.members).toHaveLength(2);
    expect(group.recall).toBe(true);
    expect(group.retain).toBe(false);
  });

  it('BankPermissions supports groups and users', () => {
    const perms: BankPermissions = {
      groups: {
        executive: { recall: true, retain: true },
        _default: { recall: false, retain: false },
      },
      users: {
        vagan: { recallBudget: 'high' },
      },
    };
    expect(perms.groups?.executive?.recall).toBe(true);
    expect(perms.users?.vagan?.recallBudget).toBe('high');
  });

  it('ResolvedPermissions has all required fields', () => {
    const resolved: ResolvedPermissions = {
      canonicalId: 'ruben',
      isAnonymous: false,
      displayName: 'Ruben',
      recall: true,
      retain: true,
      retainRoles: ['user', 'assistant'],
      retainTags: ['role:executive', 'user:ruben'],
      retainEveryNTurns: 1,
      recallBudget: 'high',
      recallMaxTokens: 2048,
      recallTagGroups: null,
      llmModel: 'claude-sonnet-4-5-20250929',
      llmProvider: 'claude-code',
      excludeProviders: [],
    };
    expect(resolved.isAnonymous).toBe(false);
    expect(resolved.recallTagGroups).toBeNull();
  });

  it('PermissionOverride is a subset of GroupConfig', () => {
    const override: PermissionOverride = {
      recall: true,
      retain: false,
      retainRoles: ['assistant'],
      retainTags: ['dept:motors'],
      retainEveryNTurns: 2,
      recallBudget: 'low',
      recallMaxTokens: 512,
      recallTagGroups: [{ tags: ['dept:motors'], match: 'any' }],
      llmModel: 'gpt-4o-mini',
      llmProvider: 'openai',
      excludeProviders: ['slack'],
    };
    // This compiles = type is correct
    const groupPartial: Partial<GroupConfig> = override;
    expect(groupPartial.recall).toBe(true);
  });
});
