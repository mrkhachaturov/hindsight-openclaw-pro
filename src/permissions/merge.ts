import type { PermissionOverride } from './types.js';
import type { TagGroup } from '../types.js';

const BUDGET_ORDER: Record<string, number> = { low: 0, mid: 1, high: 2 };

/**
 * Merge multiple group permission overrides into one effective profile.
 * Groups should be passed in alphabetical order by group name for deterministic llmModel/llmProvider.
 *
 * Merge rules (from spec Section 5):
 * - recall/retain: most permissive (true > false)
 * - recallBudget: most permissive (high > mid > low)
 * - recallMaxTokens: highest value
 * - retainRoles, retainTags, excludeProviders: unioned (deduplicated)
 * - recallTagGroups: AND-ed together (null = identity element)
 * - llmModel, llmProvider: first group that defines it (alphabetical order)
 * - retainEveryNTurns: lowest value (most frequent)
 */
export function mergeGroups(groups: PermissionOverride[]): PermissionOverride {
  if (groups.length === 0) return {};
  if (groups.length === 1) return { ...groups[0] };

  const result: PermissionOverride = {};

  // Booleans: most permissive (true wins)
  const recalls = groups.filter(g => g.recall !== undefined).map(g => g.recall!);
  if (recalls.length > 0) result.recall = recalls.some(v => v === true);

  const retains = groups.filter(g => g.retain !== undefined).map(g => g.retain!);
  if (retains.length > 0) result.retain = retains.some(v => v === true);

  // Budget: most permissive
  const budgets = groups.filter(g => g.recallBudget !== undefined).map(g => g.recallBudget!);
  if (budgets.length > 0) {
    result.recallBudget = budgets.reduce((a, b) =>
      (BUDGET_ORDER[a] ?? 0) >= (BUDGET_ORDER[b] ?? 0) ? a : b
    );
  }

  // Max tokens: highest value
  const tokens = groups.filter(g => g.recallMaxTokens !== undefined).map(g => g.recallMaxTokens!);
  if (tokens.length > 0) result.recallMaxTokens = Math.max(...tokens);

  // retainEveryNTurns: lowest value (most frequent)
  const turns = groups.filter(g => g.retainEveryNTurns !== undefined).map(g => g.retainEveryNTurns!);
  if (turns.length > 0) result.retainEveryNTurns = Math.min(...turns);

  // Union arrays (deduplicated)
  result.retainRoles = unionArrays(groups.map(g => g.retainRoles));
  result.retainTags = unionArrays(groups.map(g => g.retainTags));
  result.excludeProviders = unionArrays(groups.map(g => g.excludeProviders));

  // Clean up empty arrays (treat as "not defined")
  if (result.retainRoles?.length === 0) delete result.retainRoles;
  if (result.retainTags?.length === 0) delete result.retainTags;
  if (result.excludeProviders?.length === 0) delete result.excludeProviders;

  // recallTagGroups: AND-ed (null = identity element)
  result.recallTagGroups = mergeTagGroups(groups.map(g => g.recallTagGroups));
  if (result.recallTagGroups === undefined) delete result.recallTagGroups;

  // First-wins (groups already in alphabetical order)
  for (const g of groups) {
    if (result.llmModel === undefined && g.llmModel !== undefined) result.llmModel = g.llmModel;
    if (result.llmProvider === undefined && g.llmProvider !== undefined) result.llmProvider = g.llmProvider;
  }

  return result;
}

/**
 * Overlay fields: for each field defined in overlay, replace in base.
 * Fields not defined (undefined) in overlay are inherited from base.
 * Note: null is a defined value (e.g., recallTagGroups: null means "no filter").
 */
export function overlayFields(base: PermissionOverride, overlay: PermissionOverride): PermissionOverride {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== undefined) {
      (result as any)[key] = value;
    }
  }
  return result;
}

/** Union multiple optional arrays, deduplicated */
function unionArrays(arrays: (string[] | undefined)[]): string[] | undefined {
  const set = new Set<string>();
  for (const arr of arrays) {
    if (arr) for (const item of arr) set.add(item);
  }
  return set.size > 0 ? [...set] : undefined;
}

/** AND tag groups together. null = identity element (null AND X = X) */
function mergeTagGroups(groups: (TagGroup[] | null | undefined)[]): TagGroup[] | null | undefined {
  const defined = groups.filter((g): g is TagGroup[] | null => g !== undefined);
  if (defined.length === 0) return undefined;

  let result: TagGroup[] | null = null;
  for (const g of defined) {
    if (g === null) continue;  // null = identity, skip
    if (result === null) {
      result = [...g];
    } else {
      result = [...result, ...g];  // AND = concatenate (top-level groups are AND-ed)
    }
  }
  return result;
}
