import type { DiscoveryResult, GroupConfig, PermissionOverride, ResolvedPermissions } from './types.js';
import { mergeGroups, overlayFields } from './merge.js';
import { debug } from '../debug.js';

/**
 * Resolve permissions for a sender on a specific bank.
 * Implements the 4-step algorithm from spec Section 6.
 *
 * @param senderId - Channel-qualified sender ID (e.g., "telegram:789012")
 * @param bankId - Target bank ID (e.g., "yoda")
 * @param discovery - Pre-built discovery result with all indexes
 * @returns Fully resolved permission flags
 */
export function resolvePermissions(
  senderId: string,
  bankId: string,
  discovery: DiscoveryResult,
): ResolvedPermissions {
  // ── Identity resolution ──
  const canonicalId = discovery.channelIndex.get(senderId) ?? null;
  const isAnonymous = canonicalId === null;
  const userProfile = canonicalId ? discovery.users.get(canonicalId) : undefined;
  const displayName = userProfile?.displayName ?? 'Anonymous';
  const userGroups = canonicalId ? (discovery.membershipIndex.get(canonicalId) ?? []) : [];

  debug(`[Hindsight Hook] Resolving permissions for ${senderId} on bank ${bankId}`);
  debug(`[Hindsight Hook] Identity: ${senderId} → ${canonicalId ?? 'anonymous'}`);
  debug(`[Hindsight Hook] Groups: [${userGroups.join(', ')}]`);

  // ── Step 1: Merge global group defaults ──
  let effective: PermissionOverride;
  if (userGroups.length > 0) {
    const groupConfigs = userGroups
      .map(name => discovery.groups.get(name))
      .filter((g): g is GroupConfig => g !== undefined);
    effective = mergeGroups(groupConfigs);
    debug(`[Hindsight Hook] Step 1 (global merge): recall=${effective.recall}, retain=${effective.retain}, budget=${effective.recallBudget}`);
  } else {
    const defaultGroup = discovery.groups.get('_default');
    if (defaultGroup) {
      const { displayName: _, members: __, ...permFields } = defaultGroup;
      effective = permFields;
    } else {
      effective = {};
    }
    debug(`[Hindsight Hook] Step 1 (no groups, using _default): recall=${effective.recall}, retain=${effective.retain}`);
  }

  // ── Bank-level resolution ──
  const bankConfig = discovery.banks.get(bankId);
  const bankPerms = bankConfig?.permissions;

  if (bankPerms) {
    // Step 2: Bank _default as baseline
    const bankDefault = bankPerms.groups?.['_default'];
    let bankEffective: PermissionOverride = bankDefault ? { ...bankDefault } : {};
    debug(`[Hindsight Hook] Step 2 (bank _default baseline): recall=${bankEffective.recall}, retain=${bankEffective.retain}`);

    // Step 3: Overlay bank-level group entries
    const bankGroupEntries = userGroups
      .filter(name => name !== '_default' && bankPerms.groups?.[name])
      .map(name => bankPerms.groups![name]);

    if (bankGroupEntries.length > 0) {
      const merged = mergeGroups(bankGroupEntries);
      bankEffective = overlayFields(bankEffective, merged);
      debug(`[Hindsight Hook] Step 3 (bank group overlay): recall=${bankEffective.recall}, retain=${bankEffective.retain}`);
    } else {
      debug(`[Hindsight Hook] Step 3 (no bank group entries for user's groups)`);
    }

    // Step 4: Overlay bank-level user override
    if (canonicalId && bankPerms.users?.[canonicalId]) {
      bankEffective = overlayFields(bankEffective, bankPerms.users[canonicalId]);
      debug(`[Hindsight Hook] Step 4 (bank user override applied for ${canonicalId})`);
    } else {
      debug(`[Hindsight Hook] Step 4 (no bank user override)`);
    }

    // Bank resolution replaces global for defined fields
    effective = overlayFields(effective, bankEffective);
  } else {
    debug(`[Hindsight Hook] No bank permissions — using global group defaults`);
  }

  // ── Build final result with defaults ──
  const retainTags = [
    ...(effective.retainTags ?? []),
    ...(isAnonymous || !canonicalId ? [] : [`user:${canonicalId}`]),
  ];

  const resolved: ResolvedPermissions = {
    canonicalId,
    isAnonymous,
    displayName,
    recall: effective.recall ?? false,
    retain: effective.retain ?? false,
    retainRoles: effective.retainRoles ?? ['user', 'assistant'],
    retainTags,
    retainEveryNTurns: effective.retainEveryNTurns ?? 1,
    recallBudget: effective.recallBudget ?? 'mid',
    recallMaxTokens: effective.recallMaxTokens ?? 1024,
    recallTagGroups: effective.recallTagGroups ?? null,
    llmModel: effective.llmModel,
    llmProvider: effective.llmProvider,
    excludeProviders: effective.excludeProviders ?? [],
  };

  debug(`[Hindsight Hook] Resolved: recall=${resolved.recall}, retain=${resolved.retain}, budget=${resolved.recallBudget}`);
  return resolved;
}
