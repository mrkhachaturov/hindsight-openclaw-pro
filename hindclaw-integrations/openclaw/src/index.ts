import type {
  MoltbotPluginAPI,
  PluginConfig,
  PluginHookAgentContext,
  BankConfig,
} from './types.js';
import { HindsightEmbedManager } from './embed-manager.js';
import { HindsightClient, type HindsightClientOptions } from './client.js';
import { resolveAgentConfig, loadBankConfigFiles } from './config.js';
import { handleRecall, resetRecallState } from './hooks/recall.js';
import { handleRetain, resetRetainState } from './hooks/retain.js';
import { stripMemoryTags } from './utils.js';
import { prepareRetentionTranscript } from './hooks/retain.js';
import { handleSessionStart } from './hooks/session-start.js';
import { deriveBankId } from './derive-bank-id.js';
import { formatMemories } from './format.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

// ── Re-exports for backward compatibility ───────────────────────────────
export { stripMemoryTags, stripMetadataEnvelopes, sliceLastTurnsByUserBoundary } from './utils.js';
export { extractRecallQuery, composeRecallQuery, truncateRecallQuery } from './utils.js';
export { prepareRetentionTranscript } from './hooks/retain.js';
export { deriveBankId } from './derive-bank-id.js';
export { formatMemories } from './format.js';

// ── Debug logging ───────────────────────────────────────────────────────
import { debug, setDebugEnabled } from './debug.js';

// ── Module-level state ──────────────────────────────────────────────────
let embedManager: HindsightEmbedManager | null = null;
let client: HindsightClient | null = null;
let clientOptions: HindsightClientOptions | null = null;
let initPromise: Promise<void> | null = null;
let isInitialized = false;
let usingExternalApi = false;

let currentPluginConfig: PluginConfig | null = null;
let bankConfigs: Map<string, BankConfig> = new Map();

// Cache sender IDs discovered in before_prompt_build for agent_end
const senderIdBySession = new Map<string, string>();
const MAX_TRACKED_SESSIONS = 10_000;

// Guard against double hook registration on the same api instance
const registeredApis = new WeakSet<object>();

// Lazy reinit state
let lastReinitAttempt = 0;
let isReinitInProgress = false;
const REINIT_COOLDOWN_MS = 30_000;

// ── Provider detection ──────────────────────────────────────────────────
const PROVIDER_DETECTION = [
  { name: 'openai', keyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini' },
  { name: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-3-5-haiku-20241022' },
  { name: 'gemini', keyEnv: 'GEMINI_API_KEY', defaultModel: 'gemini-2.5-flash' },
  { name: 'groq', keyEnv: 'GROQ_API_KEY', defaultModel: 'openai/gpt-oss-20b' },
  { name: 'ollama', keyEnv: '', defaultModel: 'llama3.2' },
  { name: 'openai-codex', keyEnv: '', defaultModel: 'gpt-5.2-codex' },
  { name: 'claude-code', keyEnv: '', defaultModel: 'claude-sonnet-4-5-20250929' },
];

const NO_KEY_REQUIRED = ['ollama', 'openai-codex', 'claude-code'];

function detectLLMConfig(pluginConfig?: PluginConfig): {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  source: string;
} {
  const overrideProvider = process.env.HINDSIGHT_API_LLM_PROVIDER;
  const overrideModel = process.env.HINDSIGHT_API_LLM_MODEL;
  const overrideKey = process.env.HINDSIGHT_API_LLM_API_KEY;
  const overrideBaseUrl = process.env.HINDSIGHT_API_LLM_BASE_URL;

  // Priority 1: env var override
  if (overrideProvider) {
    if (!overrideKey && !NO_KEY_REQUIRED.includes(overrideProvider)) {
      throw new Error(
        `HINDSIGHT_API_LLM_PROVIDER is set to "${overrideProvider}" but HINDSIGHT_API_LLM_API_KEY is not set.\n` +
        `Please set: export HINDSIGHT_API_LLM_API_KEY=your-api-key`
      );
    }
    const providerInfo = PROVIDER_DETECTION.find(p => p.name === overrideProvider);
    return {
      provider: overrideProvider,
      apiKey: overrideKey || '',
      model: overrideModel || providerInfo?.defaultModel,
      baseUrl: overrideBaseUrl,
      source: 'HINDSIGHT_API_LLM_PROVIDER override',
    };
  }

  // Priority 2: plugin config
  if (pluginConfig?.llmProvider) {
    const providerInfo = PROVIDER_DETECTION.find(p => p.name === pluginConfig.llmProvider);
    let apiKey = '';
    if (pluginConfig.llmApiKeyEnv) {
      apiKey = process.env[pluginConfig.llmApiKeyEnv] || '';
    } else if (providerInfo?.keyEnv) {
      apiKey = process.env[providerInfo.keyEnv] || '';
    }
    if (!apiKey && !NO_KEY_REQUIRED.includes(pluginConfig.llmProvider)) {
      const keySource = pluginConfig.llmApiKeyEnv || providerInfo?.keyEnv || 'unknown';
      throw new Error(
        `Plugin config llmProvider is set to "${pluginConfig.llmProvider}" but no API key found.\n` +
        `Expected env var: ${keySource}\n` +
        `Set the env var or use llmApiKeyEnv in plugin config to specify a custom env var name.`
      );
    }
    return {
      provider: pluginConfig.llmProvider,
      apiKey,
      model: pluginConfig.llmModel || overrideModel || providerInfo?.defaultModel,
      baseUrl: overrideBaseUrl,
      source: 'plugin config',
    };
  }

  // Priority 3: auto-detect from env vars
  for (const providerInfo of PROVIDER_DETECTION) {
    if (NO_KEY_REQUIRED.includes(providerInfo.name)) continue;
    const apiKey = providerInfo.keyEnv ? process.env[providerInfo.keyEnv] : '';
    if (apiKey) {
      return {
        provider: providerInfo.name,
        apiKey,
        model: overrideModel || providerInfo.defaultModel,
        baseUrl: overrideBaseUrl,
        source: `auto-detected from ${providerInfo.keyEnv}`,
      };
    }
  }

  // Allow empty LLM config for external API mode
  const externalApiCheck = detectExternalApi(pluginConfig);
  if (externalApiCheck.apiUrl) {
    return { provider: undefined, apiKey: undefined, model: undefined, baseUrl: undefined, source: 'external-api-mode-no-llm' };
  }

  throw new Error(
    `No LLM configuration found for Hindsight memory plugin.\n\n` +
    `Set a provider API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.),\n` +
    `configure llmProvider in plugin config, or use HINDSIGHT_API_LLM_PROVIDER env var.\n` +
    `If using an external Hindsight API, set HINDSIGHT_EMBED_API_URL.`
  );
}

function detectExternalApi(pluginConfig?: PluginConfig): {
  apiUrl: string | null;
} {
  const apiUrl = process.env.HINDSIGHT_EMBED_API_URL || pluginConfig?.hindsightApiUrl || null;
  return { apiUrl };
}

function buildClientOptions(
  llmConfig: { provider?: string; apiKey?: string; model?: string },
  pluginCfg: PluginConfig,
  externalApi: { apiUrl: string | null },
): HindsightClientOptions {
  return {
    llmModel: llmConfig.model,
    embedVersion: pluginCfg.embedVersion,
    embedPackagePath: pluginCfg.embedPackagePath,
    apiUrl: externalApi.apiUrl ?? undefined,
    jwtSecret: pluginCfg.jwtSecret,
    clientId: pluginCfg.clientId,
  };
}

async function checkExternalApiHealth(apiUrl: string): Promise<void> {
  const healthUrl = `${apiUrl.replace(/\/$/, '')}/health`;
  const maxRetries = 3;
  const retryDelay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      debug(`[Hindsight] Checking external API health at ${healthUrl}... (attempt ${attempt}/${maxRetries})`);
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const data = await response.json() as { status?: string };
      debug(`[Hindsight] External API health: ${JSON.stringify(data)}`);
      return;
    } catch (error) {
      if (attempt < maxRetries) {
        debug(`[Hindsight] Health check attempt ${attempt} failed, retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        throw new Error(`Cannot connect to external Hindsight API at ${apiUrl}: ${error}`, { cause: error });
      }
    }
  }
}

// ── Lazy reinit ─────────────────────────────────────────────────────────
async function lazyReinit(): Promise<void> {
  const now = Date.now();
  if (now - lastReinitAttempt < REINIT_COOLDOWN_MS || isReinitInProgress) return;
  isReinitInProgress = true;
  lastReinitAttempt = now;

  const config = currentPluginConfig;
  if (!config) { isReinitInProgress = false; return; }

  const externalApi = detectExternalApi(config);
  if (!externalApi.apiUrl) { isReinitInProgress = false; return; }

  debug('[Hindsight] Attempting lazy re-initialization...');
  try {
    await checkExternalApiHealth(externalApi.apiUrl);
    process.env.HINDSIGHT_EMBED_API_URL = externalApi.apiUrl;

    const llmConfig = detectLLMConfig(config);
    clientOptions = buildClientOptions(llmConfig, config, externalApi);
    client = new HindsightClient(clientOptions);
    usingExternalApi = true;
    isInitialized = true;
    initPromise = Promise.resolve();
    debug('[Hindsight] Lazy re-initialization succeeded');
  } catch (error) {
    console.warn(`[Hindsight] Lazy re-initialization failed (will retry in ${REINIT_COOLDOWN_MS / 1000}s):`, error instanceof Error ? error.message : error);
  } finally {
    isReinitInProgress = false;
  }
}

// ── Global access for OpenClaw tools ────────────────────────────────────
if (typeof global !== 'undefined') {
  (global as any).__hindsightClient = {
    getClient: () => client,
    waitForReady: async () => {
      if (isInitialized) return;
      if (initPromise) {
        try {
          await initPromise;
        } catch {
          if (!isInitialized) await lazyReinit();
        }
      }
    },
    getClientForContext: async (ctx: PluginHookAgentContext | undefined) => {
      if (!client) return null;
      return client; // stateless: bankId is now passed per-call
    },
    getPluginConfig: () => currentPluginConfig,
  };
}

// ── Helper: extract sender ID from OpenClaw metadata blocks ─────────────
function extractSenderIdFromText(text: unknown): string | undefined {
  if (!text || typeof text !== 'string') return undefined;
  const metaBlockRe = /[\w\s]+\(untrusted metadata\)[^\n]*\n```json\n([\s\S]*?)\n```/gi;
  let match: RegExpExecArray | null;
  while ((match = metaBlockRe.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      const id = obj?.sender_id ?? obj?.id;
      if (id && typeof id === 'string') return id;
    } catch { /* continue */ }
  }
  return undefined;
}

// ── Plugin config reader ────────────────────────────────────────────────

function getPluginConfig(api: MoltbotPluginAPI): PluginConfig {
  const config = api.config.plugins?.entries?.['hindclaw']?.config || {};
  return {
    embedPort: config.embedPort || 0,
    daemonIdleTimeout: config.daemonIdleTimeout !== undefined ? config.daemonIdleTimeout : 0,
    embedVersion: config.embedVersion || 'latest',
    embedPackagePath: config.embedPackagePath,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
    llmApiKeyEnv: config.llmApiKeyEnv,
    hindsightApiUrl: config.hindsightApiUrl,
    jwtSecret: config.jwtSecret,
    clientId: config.clientId,
    apiPort: config.apiPort || 9077,
    dynamicBankId: config.dynamicBankId !== false,
    bankIdPrefix: config.bankIdPrefix,
    excludeProviders: Array.isArray(config.excludeProviders) ? config.excludeProviders : [],
    autoRecall: config.autoRecall !== false,
    dynamicBankGranularity: Array.isArray(config.dynamicBankGranularity) ? config.dynamicBankGranularity : undefined,
    autoRetain: config.autoRetain !== false,
    retainRoles: Array.isArray(config.retainRoles) ? config.retainRoles : undefined,
    recallBudget: config.recallBudget || 'mid',
    recallMaxTokens: config.recallMaxTokens || 1024,
    recallTypes: Array.isArray(config.recallTypes) ? config.recallTypes : ['world', 'experience'],
    recallRoles: Array.isArray(config.recallRoles) ? config.recallRoles : ['user', 'assistant'],
    recallTopK: typeof config.recallTopK === 'number' ? config.recallTopK : undefined,
    recallContextTurns: typeof config.recallContextTurns === 'number' && config.recallContextTurns >= 1 ? config.recallContextTurns : 1,
    recallMaxQueryChars: typeof config.recallMaxQueryChars === 'number' && config.recallMaxQueryChars >= 1 ? config.recallMaxQueryChars : 800,
    recallPromptPreamble: typeof config.recallPromptPreamble === 'string' && config.recallPromptPreamble.trim().length > 0
      ? config.recallPromptPreamble
      : undefined,
    retainEveryNTurns: typeof config.retainEveryNTurns === 'number' && config.retainEveryNTurns >= 1 ? config.retainEveryNTurns : 1,
    retainOverlapTurns: typeof config.retainOverlapTurns === 'number' && config.retainOverlapTurns >= 0 ? config.retainOverlapTurns : 0,
    debug: config.debug ?? false,
    agents: config.agents,
  };
}

// Resolve OpenClaw config directory for bank config file paths.
// Bank config paths (e.g., "./banks/yoda.json5") are relative to .openclaw/ dir.
// OPENCLAW_STATE_DIR points directly to the .openclaw/ directory and is always
// set by the gateway (including in systemd). OPENCLAW_CONFIG_PATH points to the
// config FILE so we take dirname(). Fallback to ~/.openclaw/.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const openclawConfigDir = process.env.OPENCLAW_STATE_DIR
  ?? (process.env.OPENCLAW_CONFIG_PATH ? dirname(process.env.OPENCLAW_CONFIG_PATH) : null)
  ?? join(homedir(), '.openclaw');

// ── Plugin entry point ──────────────────────────────────────────────────
export default function (api: MoltbotPluginAPI) {
  try {
    debug('[Hindsight] Plugin loading...');

    const pluginConfig = getPluginConfig(api);
    setDebugEnabled(pluginConfig.debug ?? false);
    currentPluginConfig = pluginConfig;

    // Load bank configs from agents map
    if (pluginConfig.agents) {
      try {
        bankConfigs = loadBankConfigFiles(pluginConfig.agents, openclawConfigDir);
        debug(`[Hindsight] Loaded bank configs for ${bankConfigs.size} agents`);
      } catch (error) {
        console.warn('[Hindsight] Failed to load bank config files:', error instanceof Error ? error.message : error);
      }
    }

    // Detect LLM configuration
    debug('[Hindsight] Detecting LLM config...');
    const llmConfig = detectLLMConfig(pluginConfig);
    const modelInfo = llmConfig.model || 'default';
    const baseUrlInfo = llmConfig.baseUrl ? `, base URL: ${llmConfig.baseUrl}` : '';
    debug(`[Hindsight] Using provider: ${llmConfig.provider}, model: ${modelInfo} (${llmConfig.source}${baseUrlInfo})`);
    if (pluginConfig.dynamicBankId) {
      const prefixInfo = pluginConfig.bankIdPrefix ? ` (prefix: ${pluginConfig.bankIdPrefix})` : '';
      debug(`[Hindsight] Dynamic bank IDs enabled${prefixInfo} — each channel gets isolated memory`);
    } else {
      debug('[Hindsight] Dynamic bank IDs disabled — using static bank: openclaw');
    }

    // Detect external API mode
    const externalApi = detectExternalApi(pluginConfig);
    const apiPort = pluginConfig.apiPort || 9077;

    if (externalApi.apiUrl) {
      usingExternalApi = true;
      debug(`[Hindsight] Using external API: ${externalApi.apiUrl}`);
      process.env.HINDSIGHT_EMBED_API_URL = externalApi.apiUrl;
    } else {
      debug(`[Hindsight] Daemon idle timeout: ${pluginConfig.daemonIdleTimeout}s (0 = never timeout)`);
      debug(`[Hindsight] API Port: ${apiPort}`);
    }

    // Initialize in background (non-blocking)
    // Guard: if initPromise already exists (gateway loads plugin multiple times
    // during startup/hot-reload), reuse existing initialization to prevent
    // multiple daemon starts racing for the same pg0 port
    if (initPromise) {
      debug('[Hindsight] Initialization already in progress, reusing existing promise');
    } else {
    debug('[Hindsight] Starting initialization in background...');
    initPromise = (async () => {
      try {
        if (usingExternalApi && externalApi.apiUrl) {
          debug('[Hindsight] External API mode — skipping local daemon...');
          await checkExternalApiHealth(externalApi.apiUrl);
          debug('[Hindsight] Creating HindsightClient (HTTP mode)...');
          clientOptions = buildClientOptions(llmConfig, pluginConfig, externalApi);
          client = new HindsightClient(clientOptions);
          isInitialized = true;
          debug('[Hindsight] Ready (external API mode)');
        } else {
          debug('[Hindsight] Creating HindsightEmbedManager...');
          embedManager = new HindsightEmbedManager(
            apiPort,
            llmConfig.provider || '',
            llmConfig.apiKey || '',
            llmConfig.model,
            llmConfig.baseUrl,
            pluginConfig.daemonIdleTimeout,
            pluginConfig.embedVersion,
            pluginConfig.embedPackagePath,
          );
          debug('[Hindsight] Starting embedded server...');
          await embedManager.start();
          debug('[Hindsight] Creating HindsightClient (subprocess mode)...');
          clientOptions = buildClientOptions(llmConfig, pluginConfig, { apiUrl: null });
          client = new HindsightClient(clientOptions);
          isInitialized = true;
          debug('[Hindsight] Ready');
        }
      } catch (error) {
        console.error('[Hindsight] Initialization error:', error);
        throw error;
      }
    })();

    initPromise.catch(() => {}); // suppress unhandled rejection
    } // end of initPromise guard

    // Register service for lifecycle management
    debug('[Hindsight] Registering service...');
    api.registerService({
      id: 'hindsight-memory',
      async start() {
        debug('[Hindsight] Service start called...');
        if (initPromise) {
          try { await initPromise; } catch (error) {
            console.error('[Hindsight] Initial initialization failed:', error instanceof Error ? error.message : error);
          }
        }

        if (usingExternalApi) {
          const ea = detectExternalApi(pluginConfig);
          if (ea.apiUrl && isInitialized) {
            try {
              await checkExternalApiHealth(ea.apiUrl);
              debug('[Hindsight] External API is healthy');
              return;
            } catch (error) {
              console.error('[Hindsight] External API health check failed:', error instanceof Error ? error.message : error);
              client = null; clientOptions = null; isInitialized = false;
            }
          }
        } else if (embedManager && isInitialized) {
          const healthy = await embedManager.checkHealth();
          if (healthy) { debug('[Hindsight] Daemon is healthy'); return; }
          debug('[Hindsight] Daemon is not responding — reinitializing...');
          embedManager = null; client = null; clientOptions = null; isInitialized = false;
        }

        // Reinitialize if needed
        if (!isInitialized) {
          debug('[Hindsight] Reinitializing...');
          const rc = getPluginConfig(api);
          currentPluginConfig = rc;
          const lc = detectLLMConfig(rc);
          const ea = detectExternalApi(rc);

          if (ea.apiUrl) {
            usingExternalApi = true;
            process.env.HINDSIGHT_EMBED_API_URL = ea.apiUrl;
            await checkExternalApiHealth(ea.apiUrl);
            clientOptions = buildClientOptions(lc, rc, ea);
            client = new HindsightClient(clientOptions);
          } else {
            const p = rc.apiPort || 9077;
            embedManager = new HindsightEmbedManager(p, lc.provider || '', lc.apiKey || '', lc.model, lc.baseUrl, rc.daemonIdleTimeout, rc.embedVersion, rc.embedPackagePath);
            await embedManager.start();
            clientOptions = buildClientOptions(lc, rc, { apiUrl: null });
            client = new HindsightClient(clientOptions);
          }
          isInitialized = true;
          debug('[Hindsight] Reinitialization complete');
        }
      },

      async stop() {
        try {
          debug('[Hindsight] Service stopping...');
          if (!usingExternalApi && embedManager) {
            await embedManager.stop();
            embedManager = null;
          }
          client = null;
          clientOptions = null;
          isInitialized = false;
          // Clear stale state from hooks to prevent misattribution after reinit
          senderIdBySession.clear();
          resetRetainState();
          resetRecallState();
          debug('[Hindsight] Service stopped');
        } catch (error) {
          console.error('[Hindsight] Service stop error:', error);
          throw error;
        }
      },
    });

    debug('[Hindsight] Plugin loaded successfully');

    // ── Hook registration ───────────────────────────────────────────────
    if (registeredApis.has(api)) {
      debug('[Hindsight] Hooks already registered, skipping');
      return;
    }
    registeredApis.add(api);
    debug('[Hindsight] Registering agent hooks...');

    // ── before_prompt_build (recall) ────────────────────────────────────
    api.on('before_prompt_build', async (event: any, ctx?: PluginHookAgentContext) => {
      try {
        const agentId = ctx?.agentId;
        const agentConfig = resolveAgentConfig(agentId ?? 'default', pluginConfig, bankConfigs);

        // Check exclude
        if (ctx?.messageProvider && (agentConfig.excludeProviders ?? pluginConfig.excludeProviders)?.includes(ctx.messageProvider)) {
          debug(`[Hindsight] Skipping recall for excluded provider: ${ctx.messageProvider}`);
          return;
        }

        if (agentConfig.autoRecall === false) {
          debug('[Hindsight] Auto-recall disabled, skipping');
          return;
        }

        // Enrich ctx with sender ID from metadata blocks
        const senderIdFromPrompt = !ctx?.senderId ? extractSenderIdFromText(event.prompt ?? event.rawMessage ?? '') : undefined;
        const effectiveCtx = senderIdFromPrompt ? { ...ctx, senderId: senderIdFromPrompt } : ctx;

        // Cache sender ID for agent_end
        const resolvedSenderId = effectiveCtx?.senderId;
        const sessionKey = ctx?.sessionKey;
        if (resolvedSenderId && sessionKey) {
          senderIdBySession.set(sessionKey, resolvedSenderId);
          if (senderIdBySession.size > MAX_TRACKED_SESSIONS) {
            const oldest = senderIdBySession.keys().next().value;
            if (oldest) senderIdBySession.delete(oldest);
          }
        }

        // Wait for client
        await waitForClient();
        if (!client) { debug('[Hindsight] Client not ready, skipping recall'); return; }

        const result = await handleRecall(event, effectiveCtx, agentConfig, client, pluginConfig);
        if (result) {
          return { prependSystemContext: result };
        }
      } catch (error) {
        console.error('[Hindsight] Auto-recall error:', error instanceof Error ? error.message : error);
      }
    });

    // ── session_start (mental models) ───────────────────────────────────
    api.on('session_start', async (event: any, ctx?: PluginHookAgentContext) => {
      try {
        const agentId = ctx?.agentId;
        const agentConfig = resolveAgentConfig(agentId ?? 'default', pluginConfig, bankConfigs);

        await waitForClient();
        if (!client) return;

        const result = await handleSessionStart(agentConfig, client);
        if (result) {
          return { prependSystemContext: result };
        }
      } catch (error) {
        console.warn('[Hindsight] Session start error:', error instanceof Error ? error.message : error);
      }
    });

    // ── agent_end (retain) ──────────────────────────────────────────────
    api.on('agent_end', async (event: any, ctx?: PluginHookAgentContext) => {
      try {
        // Build effective context
        const eventSessionKey = typeof event?.sessionKey === 'string' ? event.sessionKey : undefined;
        const effectiveCtx = ctx || (eventSessionKey ? ({ sessionKey: eventSessionKey } as PluginHookAgentContext) : undefined);

        const agentId = effectiveCtx?.agentId;
        const agentConfig = resolveAgentConfig(agentId ?? 'default', pluginConfig, bankConfigs);

        // Check exclude
        if (effectiveCtx?.messageProvider && (agentConfig.excludeProviders ?? pluginConfig.excludeProviders)?.includes(effectiveCtx.messageProvider)) {
          debug(`[Hindsight] Skipping retain for excluded provider: ${effectiveCtx.messageProvider}`);
          return;
        }

        if (event.success === false) {
          debug('[Hindsight] Agent run failed, skipping retention');
          return;
        }

        // Enrich sender ID from cache
        const senderIdFromCache = !effectiveCtx?.senderId && effectiveCtx?.sessionKey
          ? senderIdBySession.get(effectiveCtx.sessionKey)
          : undefined;
        const effectiveCtxForRetain = senderIdFromCache ? { ...effectiveCtx, senderId: senderIdFromCache } : effectiveCtx;

        await waitForClient();
        if (!client) { console.warn('[Hindsight] Client not ready, skipping retain'); return; }

        await handleRetain(event, effectiveCtxForRetain, agentConfig, client, pluginConfig);
      } catch (error) {
        console.error('[Hindsight] Error retaining messages:', error);
      }
    });

    debug('[Hindsight] Hooks registered');
  } catch (error) {
    console.error('[Hindsight] Plugin loading error:', error);
    if (error instanceof Error) console.error('[Hindsight] Error stack:', error.stack);
    throw error;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function waitForClient(): Promise<void> {
  const clientGlobal = (global as any).__hindsightClient;
  if (clientGlobal) await clientGlobal.waitForReady();
}

// Export client getter for tools
export function getClient() {
  return client;
}
