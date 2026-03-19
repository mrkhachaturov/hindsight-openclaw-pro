// ── OpenClaw Plugin SDK types (minimal subset) ──────────────────────

export interface PluginPromptHookResult {
  prependContext?: string;
  prependSystemContext?: string;
}

export interface MoltbotPluginAPI {
  config: MoltbotConfig;
  registerService(config: ServiceConfig): void;
  on(event: string, handler: (event: any, ctx?: any) => void | Promise<void | PluginPromptHookResult>): void;
}

export interface MoltbotConfig {
  agents?: {
    defaults?: {
      models?: {
        [modelName: string]: {
          alias?: string;
        };
      };
    };
  };
  plugins?: {
    entries?: {
      [pluginId: string]: {
        enabled?: boolean;
        config?: PluginConfig;
      };
    };
  };
}

export interface PluginHookAgentContext {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;
  channelId?: string;
  senderId?: string;
}

export interface ServiceConfig {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ── Plugin Configuration ─────────────────────────────────────────────

export interface AgentEntry {
  bankConfig: string;
}

export interface PluginConfig {
  // Infrastructure (per-agent overridable)
  hindsightApiUrl?: string;
  hindsightApiToken?: string;

  // Bank mission (I2-I3: automatic bank mission for unconfigured banks)
  bankMission?: string;

  // Daemon (global only)
  apiPort?: number;
  embedPort?: number;
  embedVersion?: string;
  embedPackagePath?: string;
  daemonIdleTimeout?: number;

  // Routing (per-agent overridable)
  dynamicBankGranularity?: Array<'agent' | 'provider' | 'channel' | 'user'>;
  dynamicBankId?: boolean;
  bankIdPrefix?: string;

  // Behavioral (per-agent overridable)
  llmProvider?: string;
  llmModel?: string;
  llmApiKeyEnv?: string;
  autoRecall?: boolean;
  autoRetain?: boolean;
  recallBudget?: 'low' | 'mid' | 'high';
  recallMaxTokens?: number;
  recallTypes?: Array<'world' | 'experience' | 'observation'>;
  recallRoles?: Array<'user' | 'assistant' | 'system' | 'tool'>;
  recallTopK?: number;
  recallContextTurns?: number;
  recallMaxQueryChars?: number;
  recallPromptPreamble?: string;
  retainRoles?: Array<'user' | 'assistant' | 'system' | 'tool'>;
  retainEveryNTurns?: number;
  retainOverlapTurns?: number;
  excludeProviders?: string[];
  debug?: boolean;

  // Agent map
  agents?: Record<string, AgentEntry>;

  // Bootstrap bank configs on first run if bank is empty
  bootstrap?: boolean;
}

// ── Bank Config File (template) ──────────────────────────────────────

export interface BankConfigDirective {
  name: string;
  content: string;
}

export interface EntityLabelValue {
  value: string;
  description: string;
}

export interface EntityLabel {
  key: string;
  description: string;
  type: 'value' | 'multi-values' | 'text';
  tag?: boolean;
  optional?: boolean;
  values?: EntityLabelValue[];
}

export interface RecallFromEntry {
  bankId: string;
  budget?: 'low' | 'mid' | 'high';
  maxTokens?: number;
  types?: Array<'world' | 'experience' | 'observation'>;
  tagGroups?: TagGroup[];
}

export interface MemoryScope {
  topics?: string[];
  // Future: channels?: string[]; providers?: string[];
}

export interface MemoryRouting {
  default: 'full' | 'recall' | 'disabled';
  full?: Record<string, MemoryScope>;
  recall?: Record<string, MemoryScope>;
  disabled?: Record<string, MemoryScope>;
}

export interface TopicIndexEntry {
  strategy: string;
  mode: 'full' | 'recall' | 'disabled';
}

export interface BankConfig {
  // Infrastructure overrides (per-agent)
  hindsightApiUrl?: string;
  hindsightApiToken?: string;

  // Behavioral overrides
  llmProvider?: string;
  llmModel?: string;
  llmApiKeyEnv?: string;
  autoRecall?: boolean;
  autoRetain?: boolean;
  recallBudget?: 'low' | 'mid' | 'high';
  recallMaxTokens?: number;
  recallTypes?: Array<'world' | 'experience' | 'observation'>;
  recallRoles?: Array<'user' | 'assistant' | 'system' | 'tool'>;
  recallTopK?: number;
  recallContextTurns?: number;
  recallMaxQueryChars?: number;
  recallPromptPreamble?: string;
  retainRoles?: Array<'user' | 'assistant' | 'system' | 'tool'>;
  retainEveryNTurns?: number;
  retainOverlapTurns?: number;
  excludeProviders?: string[];
  dynamicBankGranularity?: Array<'agent' | 'provider' | 'channel' | 'user'>;
  dynamicBankId?: boolean;
  bankIdPrefix?: string;
  debug?: boolean;

  // Server-side (agent-only)
  retain_mission?: string;
  observations_mission?: string;
  reflect_mission?: string;
  retain_extraction_mode?: string;
  disposition_skepticism?: number;
  disposition_literalism?: number;
  disposition_empathy?: number;
  entity_labels?: EntityLabel[];
  directives?: BankConfigDirective[];

  // Tag injection (agent-only)
  retainTags?: string[];
  retainContext?: string;
  retainObservationScopes?: string | string[][];
  recallTags?: string[];
  recallTagsMatch?: 'any' | 'all' | 'any_strict' | 'all_strict';

  // Multi-bank (agent-only)
  recallFrom?: RecallFromEntry[];

  // Session start (agent-only)
  sessionStartModels?: SessionStartModelConfig[];

  // Reflect (agent-only)
  reflectOnRecall?: boolean;
  reflectBudget?: 'low' | 'mid' | 'high';
  reflectMaxTokens?: number;

  // Memory routing (plugin-side)
  memory?: MemoryRouting;

  // Retain strategies (server-side, synced via hoppro)
  retain_strategies?: Record<string, Record<string, unknown>>;
  retain_default_strategy?: string;
  retain_chunk_size?: number;
}

// ── Resolved Config (after merge) ────────────────────────────────────

export interface ServerConfig {
  retain_mission?: string;
  observations_mission?: string;
  reflect_mission?: string;
  retain_extraction_mode?: string;
  disposition_skepticism?: number;
  disposition_literalism?: number;
  disposition_empathy?: number;
  entity_labels?: EntityLabel[];
  directives?: BankConfigDirective[];
  retain_strategies?: Record<string, Record<string, unknown>>;
  retain_default_strategy?: string;
  retain_chunk_size?: number;
}

export interface ResolvedConfig {
  // Infrastructure
  hindsightApiUrl?: string;
  hindsightApiToken?: string;

  // Daemon
  apiPort?: number;
  embedPort?: number;
  embedVersion?: string;
  embedPackagePath?: string;
  daemonIdleTimeout?: number;

  // Routing
  dynamicBankGranularity?: Array<'agent' | 'provider' | 'channel' | 'user'>;
  dynamicBankId?: boolean;
  bankIdPrefix?: string;

  // Behavioral
  llmProvider?: string;
  llmModel?: string;
  llmApiKeyEnv?: string;
  autoRecall?: boolean;
  autoRetain?: boolean;
  recallBudget?: 'low' | 'mid' | 'high';
  recallMaxTokens?: number;
  recallTypes?: Array<'world' | 'experience' | 'observation'>;
  recallRoles?: Array<'user' | 'assistant' | 'system' | 'tool'>;
  recallTopK?: number;
  recallContextTurns?: number;
  recallMaxQueryChars?: number;
  recallPromptPreamble?: string;
  retainRoles?: Array<'user' | 'assistant' | 'system' | 'tool'>;
  retainEveryNTurns?: number;
  retainOverlapTurns?: number;
  excludeProviders?: string[];
  debug?: boolean;

  // Tag injection
  retainTags?: string[];
  retainContext?: string;
  retainObservationScopes?: string | string[][];
  recallTags?: string[];
  recallTagsMatch?: 'any' | 'all' | 'any_strict' | 'all_strict';

  // Merged internal fields
  _serverConfig?: ServerConfig | null;
  _recallFrom?: RecallFromEntry[];
  _sessionStartModels?: SessionStartModelConfig[];
  _reflectOnRecall?: boolean;
  _reflectBudget?: 'low' | 'mid' | 'high';
  _reflectMaxTokens?: number;

  // Memory routing (resolved from bankConfig.memory)
  _topicIndex?: Map<string, TopicIndexEntry>;
  _defaultMode?: 'full' | 'recall' | 'disabled';
}

// ── Session Start ────────────────────────────────────────────────────

export type SessionStartModelConfig =
  | { type: 'mental_model'; bankId: string; modelId: string; label: string; roles?: string[] }
  | { type: 'recall'; bankId: string; query: string; label: string; maxTokens?: number; roles?: string[] };

// ── Hindsight API Types ──────────────────────────────────────────────

// Tag groups for compound filtering
export type TagGroup =
  | { tags: string[]; match: 'any' | 'all' | 'any_strict' | 'all_strict' }
  | { and: TagGroup[] }
  | { or: TagGroup[] }
  | { not: TagGroup };

export interface RetainItem {
  content: string;
  timestamp?: string;
  context?: string | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  document_id?: string;
  entities?: string[];
  tags?: string[];
  observation_scopes?: string | string[][];
  strategy?: string;
}

export interface RetainRequest {
  items: RetainItem[];
  async?: boolean;
}

export interface RetainResponse {
  message: string;
  document_id: string;
  memory_unit_ids: string[];
}

export interface RecallRequest {
  query: string;
  types?: Array<'world' | 'experience' | 'observation'>;
  budget?: 'low' | 'mid' | 'high';
  max_tokens?: number;
  query_timestamp?: string;
  trace?: boolean;
  tag_groups?: TagGroup[];
  include?: string[];
}

export interface MemoryResult {
  id: string;
  text: string;
  type: string;
  entities: string[];
  context: string;
  occurred_start: string | null;
  occurred_end: string | null;
  mentioned_at: string | null;
  document_id: string | null;
  metadata: Record<string, unknown> | null;
  chunk_id: string | null;
  tags: string[];
}

export interface RecallResponse {
  results: MemoryResult[];
  entities: Record<string, unknown> | null;
  trace: unknown | null;
  chunks: unknown | null;
}

export interface ReflectRequest {
  query: string;
  budget?: 'low' | 'mid' | 'high';
  max_tokens?: number;
  response_schema?: Record<string, unknown>;
  tag_groups?: TagGroup[];
  include?: string[];
}

export interface ReflectResponse {
  text: string;
  structured_output?: unknown;
  based_on?: string[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

// Full API entity (with server-assigned fields)
export interface Directive {
  id: string;
  bank_id: string;
  name: string;
  content: string;
  priority: number;
  is_active: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateDirectiveRequest {
  name: string;
  content: string;
  priority?: number;
  is_active?: boolean;
  tags?: string[];
}

export interface MentalModel {
  id: string;
  bank_id: string;
  name: string;
  source_query: string;
  content: string;
  trigger: string;
  created_at: string;
  updated_at: string;
}

export interface BankProfile {
  bank_id: string;
  name: string;
  created_at: string;
}

export interface BankConfigResponse {
  config: Record<string, unknown>;
  overrides: Record<string, unknown>;
}

// Legacy compat — kept for existing callers
export interface CreateBankRequest {
  name: string;
  background_context?: string;
}

export interface CreateBankResponse {
  bank_id: string;
  name: string;
  created_at: string;
}
