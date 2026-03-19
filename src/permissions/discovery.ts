import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import JSON5 from 'json5';
import { resolveIncludes } from '../config.js';
import type { UserProfile, GroupConfig, DiscoveryResult } from './types.js';

/**
 * Scan a configPath directory and load all banks, groups, users.
 * Throws on critical errors (missing _default, missing dirs).
 * Returns parsed configs ready for index building.
 */
export function scanConfigPath(configPath: string): DiscoveryResult {
  if (!existsSync(configPath)) {
    throw new Error(`[Hindsight] configPath does not exist: ${configPath}`);
  }

  for (const subdir of ['banks', 'groups', 'users']) {
    if (!existsSync(join(configPath, subdir))) {
      throw new Error(`[Hindsight] Required subdirectory missing: ${configPath}/${subdir}`);
    }
  }

  const users = loadDirectory<UserProfile>(join(configPath, 'users'));
  const groups = loadDirectory<GroupConfig>(join(configPath, 'groups'));
  const banks = loadDirectory<any>(join(configPath, 'banks'));

  if (!groups.has('_default')) {
    throw new Error('[Hindsight] Required file missing: groups/_default.json5');
  }

  console.log(`[Hindsight] Discovered ${banks.size} banks, ${groups.size} groups, ${users.size} users`);

  return {
    banks,
    groups,
    users,
    channelIndex: new Map(),
    membershipIndex: new Map(),
    strategyIndex: new Map(),
  };
}

/**
 * Build reverse index: "provider:senderId" → canonicalId
 * Throws on duplicate channel IDs.
 */
export function buildChannelIndex(users: Map<string, UserProfile>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [userId, profile] of users) {
    for (const [provider, senderId] of Object.entries(profile.channels)) {
      const key = `${provider}:${senderId}`;
      if (index.has(key)) {
        throw new Error(
          `[Hindsight] Duplicate channel ID: ${key} is mapped to both "${index.get(key)}" and "${userId}"`
        );
      }
      index.set(key, userId);
    }
  }
  console.log(`[Hindsight] Built channelIndex: ${index.size} channel mappings across ${users.size} users`);
  return index;
}

/**
 * Build reverse index: canonicalId → [groupName, ...]
 * Groups define their own members.
 */
export function buildMembershipIndex(groups: Map<string, GroupConfig>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [groupName, config] of groups) {
    if (groupName === '_default') continue;  // _default has no members
    for (const userId of config.members) {
      const existing = index.get(userId) ?? [];
      existing.push(groupName);
      index.set(userId, existing);
    }
  }

  // Sort group lists alphabetically for deterministic merge order
  for (const [userId, groupList] of index) {
    index.set(userId, groupList.sort());
  }

  const summary = [...index.entries()]
    .map(([id, groups]) => `${id}→[${groups.join(',')}]`)
    .join(', ');
  console.log(`[Hindsight] Built membershipIndex: ${summary}`);

  return index;
}

/**
 * Build strategy index: "bankId:topicId" → strategyName
 * Reads retain.strategies from each bank config.
 */
export function buildStrategyIndex(banks: Map<string, any>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [bankId, config] of banks) {
    const strategies = config.retain?.strategies;
    if (!strategies) continue;
    for (const [strategyName, scope] of Object.entries(strategies)) {
      const topics = (scope as any)?.topics;
      if (!Array.isArray(topics)) continue;
      for (const topicId of topics) {
        const key = `${bankId}:${topicId}`;
        if (index.has(key)) {
          throw new Error(
            `[Hindsight] Duplicate topic ID: ${key} mapped to both "${index.get(key)}" and "${strategyName}"`
          );
        }
        index.set(key, strategyName);
      }
    }
  }
  return index;
}

/**
 * Validate discovery result. Returns array of warning messages.
 * Does not throw — warnings are non-fatal.
 */
export function validateDiscovery(
  discovery: DiscoveryResult,
  membershipIndex: Map<string, string[]>,
): string[] {
  const warnings: string[] = [];

  // Users not in any group
  for (const userId of discovery.users.keys()) {
    if (!membershipIndex.has(userId)) {
      warnings.push(`User "${userId}" exists but is not a member of any group`);
    }
  }

  // Group members not in users
  for (const [groupName, config] of discovery.groups) {
    if (groupName === '_default') continue;
    for (const member of config.members) {
      if (!discovery.users.has(member)) {
        warnings.push(`Group "${groupName}" has member "${member}" not found in users/`);
      }
    }
    // Non-default group with empty members
    if (config.members.length === 0) {
      warnings.push(`Group "${groupName}" has no members`);
    }
  }

  // _default group with retain: true
  const defaultGroup = discovery.groups.get('_default');
  if (defaultGroup?.retain === true) {
    warnings.push('_default group has retain: true — anonymous facts cannot be attributed');
  }

  // Bank permissions referencing non-existent groups
  for (const [bankId, config] of discovery.banks) {
    const perms = config.permissions;
    if (!perms?.groups) continue;
    for (const groupName of Object.keys(perms.groups)) {
      if (groupName !== '_default' && !discovery.groups.has(groupName)) {
        warnings.push(`Bank "${bankId}" permissions reference non-existent group "${groupName}"`);
      }
    }
  }

  return warnings;
}

/** Load all .json5 files from a directory, excluding _template.json5 */
function loadDirectory<T>(dirPath: string): Map<string, T> {
  const result = new Map<string, T>();
  const files = readdirSync(dirPath).filter(f =>
    f.endsWith('.json5') && f !== '_template.json5'
  );

  for (const file of files) {
    const filePath = join(dirPath, file);
    const name = basename(file, '.json5');
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON5.parse(raw);
      const resolved = resolveIncludes(parsed, dirPath);
      result.set(name, resolved as T);
    } catch (err: any) {
      console.warn(`[Hindsight] ⚠ Failed to load ${filePath}: ${err.message}`);
    }
  }

  return result;
}
