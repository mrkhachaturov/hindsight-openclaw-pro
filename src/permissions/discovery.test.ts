import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  scanConfigPath,
  buildChannelIndex,
  buildMembershipIndex,
  buildStrategyIndex,
  validateDiscovery,
} from './discovery.js';

const TEST_DIR = join(tmpdir(), `hoppro-discovery-test-${Date.now()}`);

function writeJson5(path: string, data: any) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

beforeEach(() => {
  // Create directory structure
  mkdirSync(join(TEST_DIR, 'banks'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'groups'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'users'), { recursive: true });

  // Users
  writeJson5(join(TEST_DIR, 'users', 'ruben.json5'), {
    displayName: 'Ruben',
    email: 'ruben@astrateam.ru',
    channels: { telegram: '123456', slack: 'U123456' },
  });
  writeJson5(join(TEST_DIR, 'users', 'vagan.json5'), {
    displayName: 'Vagan',
    channels: { telegram: '789012' },
  });
  writeJson5(join(TEST_DIR, 'users', '_template.json5'), {
    displayName: 'TEMPLATE',
    channels: {},
  });

  // Groups
  writeJson5(join(TEST_DIR, 'groups', '_default.json5'), {
    displayName: 'Anonymous',
    members: [],
    recall: false,
    retain: false,
  });
  writeJson5(join(TEST_DIR, 'groups', 'executive.json5'), {
    displayName: 'Executive',
    members: ['ruben'],
    recall: true,
    retain: true,
    recallBudget: 'high',
  });
  writeJson5(join(TEST_DIR, 'groups', 'motors.json5'), {
    displayName: 'AstroMotors',
    members: ['vagan'],
    retainTags: ['department:motors'],
  });
  writeJson5(join(TEST_DIR, 'groups', '_template.json5'), {
    displayName: 'TEMPLATE',
    members: [],
  });

  // Banks (minimal — just need permissions for testing)
  writeJson5(join(TEST_DIR, 'banks', 'yoda.json5'), {
    bank_id: 'yoda',
    retain_mission: 'test',
    permissions: {
      groups: {
        executive: { recall: true, retain: true },
        _default: { recall: false, retain: false },
      },
    },
  });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('scanConfigPath', () => {
  it('discovers users (excluding _template)', () => {
    const result = scanConfigPath(TEST_DIR);
    expect(result.users.size).toBe(2);
    expect(result.users.has('ruben')).toBe(true);
    expect(result.users.has('vagan')).toBe(true);
    expect(result.users.has('_template')).toBe(false);
  });

  it('discovers groups (excluding _template)', () => {
    const result = scanConfigPath(TEST_DIR);
    expect(result.groups.size).toBe(3);  // _default, executive, motors
    expect(result.groups.has('_default')).toBe(true);
    expect(result.groups.has('executive')).toBe(true);
    expect(result.groups.has('_template')).toBe(false);
  });

  it('discovers banks', () => {
    const result = scanConfigPath(TEST_DIR);
    expect(result.banks.size).toBe(1);
    expect(result.banks.has('yoda')).toBe(true);
  });

  it('throws if _default group is missing', () => {
    rmSync(join(TEST_DIR, 'groups', '_default.json5'));
    expect(() => scanConfigPath(TEST_DIR)).toThrow('_default');
  });

  it('throws if configPath does not exist', () => {
    expect(() => scanConfigPath('/nonexistent/path')).toThrow();
  });

  it('throws if subdirs are missing', () => {
    rmSync(join(TEST_DIR, 'users'), { recursive: true });
    expect(() => scanConfigPath(TEST_DIR)).toThrow('users');
  });
});

describe('buildChannelIndex', () => {
  it('maps channel IDs to canonical user IDs', () => {
    const discovery = scanConfigPath(TEST_DIR);
    const index = buildChannelIndex(discovery.users);
    expect(index.get('telegram:123456')).toBe('ruben');
    expect(index.get('slack:U123456')).toBe('ruben');
    expect(index.get('telegram:789012')).toBe('vagan');
  });

  it('throws on duplicate channel ID', () => {
    writeJson5(join(TEST_DIR, 'users', 'duplicate.json5'), {
      displayName: 'Duplicate',
      channels: { telegram: '123456' },  // same as ruben
    });
    const discovery = scanConfigPath(TEST_DIR);
    expect(() => buildChannelIndex(discovery.users)).toThrow('Duplicate');
  });
});

describe('buildMembershipIndex', () => {
  it('maps users to their groups', () => {
    const discovery = scanConfigPath(TEST_DIR);
    const index = buildMembershipIndex(discovery.groups);
    expect(index.get('ruben')?.sort()).toEqual(['executive']);
    expect(index.get('vagan')?.sort()).toEqual(['motors']);
  });

  it('user in multiple groups appears in all', () => {
    // Add vagan to executive too
    writeJson5(join(TEST_DIR, 'groups', 'executive.json5'), {
      displayName: 'Executive',
      members: ['ruben', 'vagan'],
      recall: true,
      retain: true,
    });
    const discovery = scanConfigPath(TEST_DIR);
    const index = buildMembershipIndex(discovery.groups);
    expect(index.get('vagan')?.sort()).toEqual(['executive', 'motors']);
  });
});

describe('buildStrategyIndex', () => {
  it('maps bankId:topicId to strategy name', () => {
    writeJson5(join(TEST_DIR, 'banks', 'r4p17.json5'), {
      bank_id: 'r4p17',
      retain: {
        strategies: {
          detailed: { topics: ['280304'] },
          lightweight: { topics: ['280418', '280419'] },
        },
      },
    });
    const discovery = scanConfigPath(TEST_DIR);
    const index = buildStrategyIndex(discovery.banks);
    expect(index.get('r4p17:280304')).toBe('detailed');
    expect(index.get('r4p17:280418')).toBe('lightweight');
    expect(index.get('r4p17:280419')).toBe('lightweight');
  });

  it('throws on duplicate topic ID across strategies', () => {
    writeJson5(join(TEST_DIR, 'banks', 'bad.json5'), {
      bank_id: 'bad',
      retain: {
        strategies: {
          stratA: { topics: ['100'] },
          stratB: { topics: ['100'] },  // duplicate
        },
      },
    });
    const discovery = scanConfigPath(TEST_DIR);
    expect(() => buildStrategyIndex(discovery.banks)).toThrow('Duplicate topic');
  });

  it('returns empty map for banks without strategies', () => {
    // yoda bank from beforeEach has no retain.strategies
    const discovery = scanConfigPath(TEST_DIR);
    const index = buildStrategyIndex(discovery.banks);
    expect(index.size).toBe(0);
  });
});

describe('validateDiscovery', () => {
  it('returns warnings for user not in any group', () => {
    writeJson5(join(TEST_DIR, 'users', 'orphan.json5'), {
      displayName: 'Orphan',
      channels: { telegram: '999999' },
    });
    const discovery = scanConfigPath(TEST_DIR);
    const membership = buildMembershipIndex(discovery.groups);
    const warnings = validateDiscovery(discovery, membership);
    expect(warnings.some(w => w.includes('orphan'))).toBe(true);
  });

  it('returns warnings for group member not in users', () => {
    writeJson5(join(TEST_DIR, 'groups', 'bad.json5'), {
      displayName: 'Bad',
      members: ['nonexistent_user'],
    });
    const discovery = scanConfigPath(TEST_DIR);
    const membership = buildMembershipIndex(discovery.groups);
    const warnings = validateDiscovery(discovery, membership);
    expect(warnings.some(w => w.includes('nonexistent_user'))).toBe(true);
  });

  it('returns warning for non-default group with empty members', () => {
    writeJson5(join(TEST_DIR, 'groups', 'empty.json5'), {
      displayName: 'Empty',
      members: [],
    });
    const discovery = scanConfigPath(TEST_DIR);
    const membership = buildMembershipIndex(discovery.groups);
    const warnings = validateDiscovery(discovery, membership);
    expect(warnings.some(w => w.includes('empty') && w.includes('no members'))).toBe(true);
  });

  it('returns warning when _default group has retain: true', () => {
    writeJson5(join(TEST_DIR, 'groups', '_default.json5'), {
      displayName: 'Anonymous',
      members: [],
      recall: false,
      retain: true,
    });
    const discovery = scanConfigPath(TEST_DIR);
    const membership = buildMembershipIndex(discovery.groups);
    const warnings = validateDiscovery(discovery, membership);
    expect(warnings.some(w => w.includes('_default') && w.includes('retain: true'))).toBe(true);
  });

  it('returns warning for bank referencing non-existent group', () => {
    writeJson5(join(TEST_DIR, 'banks', 'bad-bank.json5'), {
      bank_id: 'bad-bank',
      permissions: {
        groups: {
          ghost_group: { recall: true },
          _default: { recall: false },
        },
      },
    });
    const discovery = scanConfigPath(TEST_DIR);
    const membership = buildMembershipIndex(discovery.groups);
    const warnings = validateDiscovery(discovery, membership);
    expect(warnings.some(w => w.includes('ghost_group'))).toBe(true);
  });
});
