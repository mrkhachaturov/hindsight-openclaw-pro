import type { PluginHookAgentContext, PluginConfig } from './types.js';

// Default bank name (fallback when channel context not available)
const DEFAULT_BANK_NAME = 'openclaw';

/**
 * Parse the OpenClaw sessionKey to extract context fields.
 * Format: "agent:{agentId}:{provider}:{channelType}:{channelId}[:{extra}]"
 * Example: "agent:c0der:telegram:group:-1003825475854:topic:42"
 */
export function parseSessionKey(sessionKey: string): { agentId?: string; provider?: string; channel?: string } {
  const parts = sessionKey.split(':');
  if (parts.length < 5 || parts[0] !== 'agent') return {};
  // parts[1] = agentId, parts[2] = provider, parts[3] = channelType, parts[4..] = channelId + extras
  return {
    agentId: parts[1],
    provider: parts[2],
    // Rejoin from channelType onward as the channel identifier (e.g. "group:-1003825475854:topic:42")
    channel: parts.slice(3).join(':'),
  };
}

/**
 * Derive a bank ID from the agent context.
 * Uses configurable dynamicBankGranularity to determine bank segmentation.
 * Falls back to default bank when context is unavailable.
 */
export function deriveBankId(ctx: PluginHookAgentContext | undefined, pluginConfig: PluginConfig): string {
  if (pluginConfig.dynamicBankId === false) {
    return pluginConfig.bankIdPrefix ? `${pluginConfig.bankIdPrefix}-${DEFAULT_BANK_NAME}` : DEFAULT_BANK_NAME;
  }

  // When no context is available, fall back to the static default bank.
  if (!ctx) {
    return pluginConfig.bankIdPrefix ? `${pluginConfig.bankIdPrefix}-${DEFAULT_BANK_NAME}` : DEFAULT_BANK_NAME;
  }

  const fields = pluginConfig.dynamicBankGranularity?.length ? pluginConfig.dynamicBankGranularity : ['agent', 'channel', 'user'];

  // Validate field names at runtime — typos silently produce 'unknown' segments
  const validFields = new Set(['agent', 'channel', 'user', 'provider']);
  for (const f of fields) {
    if (!validFields.has(f)) {
      console.warn(`[Hindsight] Unknown dynamicBankGranularity field "${f}" — will resolve to "unknown" in bank ID. Valid fields: agent, channel, user, provider`);
    }
  }

  // Parse sessionKey as fallback when direct context fields are missing
  const sessionParsed = ctx?.sessionKey ? parseSessionKey(ctx.sessionKey) : {};

  const fieldMap: Record<string, string> = {
    agent: ctx?.agentId || sessionParsed.agentId || 'default',
    channel: ctx?.channelId || sessionParsed.channel || 'unknown',
    user: ctx?.senderId || 'anonymous',
    provider: ctx?.messageProvider || sessionParsed.provider || 'unknown',
  };

  const baseBankId = fields
    .map(f => encodeURIComponent(fieldMap[f] || 'unknown'))
    .join('::');

  return pluginConfig.bankIdPrefix
    ? `${pluginConfig.bankIdPrefix}-${baseBankId}`
    : baseBankId;
}
