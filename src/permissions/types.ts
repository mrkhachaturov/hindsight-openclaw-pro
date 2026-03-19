import type { TagGroup } from '../types.js';

/**
 * User profile — identity only. Loaded from .openclaw/hindsight/users/<id>.json5
 * File name (without extension) = canonical user ID.
 */
export interface UserProfile {
  displayName: string;
  email?: string;
  channels: Record<string, string>;  // provider → senderId (e.g., { telegram: "789012" })
}

/**
 * Group config — members + permission defaults.
 * Loaded from .openclaw/hindsight/groups/<name>.json5
 * File name (without extension) = group name.
 */
export interface GroupConfig {
  displayName: string;
  members: string[];  // canonical user IDs

  // Access flags
  recall?: boolean;
  retain?: boolean;

  // Retain behavior
  retainRoles?: string[];
  retainTags?: string[];
  retainEveryNTurns?: number;

  // Recall behavior
  recallBudget?: 'low' | 'mid' | 'high';
  recallMaxTokens?: number;
  recallTagGroups?: TagGroup[] | null;

  // LLM
  llmModel?: string;
  llmProvider?: string;

  // Provider filtering
  excludeProviders?: string[];
}

/**
 * Bank-level permissions — RBAC with per-bank overrides.
 * Defined inside bank config files under the "permissions" key.
 */
export interface BankPermissions {
  groups?: Record<string, PermissionOverride>;  // group name → override
  users?: Record<string, PermissionOverride>;   // canonical user ID → override
}

/**
 * Permission override — same fields as GroupConfig minus displayName/members.
 * Used at bank level (both group and user overrides).
 */
export interface PermissionOverride {
  recall?: boolean;
  retain?: boolean;
  retainRoles?: string[];
  retainTags?: string[];
  retainEveryNTurns?: number;
  recallBudget?: 'low' | 'mid' | 'high';
  recallMaxTokens?: number;
  recallTagGroups?: TagGroup[] | null;
  llmModel?: string;
  llmProvider?: string;
  excludeProviders?: string[];
}

/**
 * Resolved permission flags — the final result of the 4-step algorithm.
 * Every field is fully resolved (no undefined except tagGroups which can be null).
 */
export interface ResolvedPermissions {
  canonicalId: string | null;       // null = anonymous
  isAnonymous: boolean;
  displayName: string;              // from user profile or "Anonymous"

  recall: boolean;
  retain: boolean;
  retainRoles: string[];
  retainTags: string[];             // includes auto-generated user:<id> tag
  retainEveryNTurns: number;
  recallBudget: 'low' | 'mid' | 'high';
  recallMaxTokens: number;
  recallTagGroups: TagGroup[] | null;  // null = no filter
  llmModel: string | undefined;
  llmProvider: string | undefined;
  excludeProviders: string[];
}

/**
 * Result of scanning the configPath directory.
 * Built once at startup, immutable after that.
 */
export interface DiscoveryResult {
  banks: Map<string, any>;                        // agentId → parsed bank config (BankConfig type from ../types.ts)
  groups: Map<string, GroupConfig>;               // groupName → group config
  users: Map<string, UserProfile>;                // canonicalId → user profile
  channelIndex: Map<string, string>;              // "provider:senderId" → canonicalId
  membershipIndex: Map<string, string[]>;         // canonicalId → [groupName, ...]
  strategyIndex: Map<string, string>;             // "bankId:topicId" → strategyName
}

/**
 * Plugin-level config loaded from .openclaw/hindsight/config.json5
 * Same fields as current PluginConfig minus agents mapping (auto-discovered).
 * Used by Plan C (hindclaw init) — defined here for type completeness.
 */
export interface HindsightConfig {
  // Daemon
  apiPort?: number;
  embedVersion?: string;
  embedPackagePath?: string;
  daemonIdleTimeout?: number;

  // Plugin behavior
  dynamicBankGranularity?: string[];
  dynamicBankId?: boolean;
  bankIdPrefix?: string;
  bootstrap?: boolean;
  debug?: boolean;

  // Infrastructure
  hindsightApiUrl?: string;
  hindsightApiToken?: string;

  // LLM defaults
  llmProvider?: string;
  llmModel?: string;

  // Behavioral defaults (overridable per-group/bank)
  autoRecall?: boolean;
  autoRetain?: boolean;
  recallBudget?: 'low' | 'mid' | 'high';
  recallMaxTokens?: number;
  recallTypes?: string[];
  retainRoles?: string[];
  retainEveryNTurns?: number;
  excludeProviders?: string[];
}
