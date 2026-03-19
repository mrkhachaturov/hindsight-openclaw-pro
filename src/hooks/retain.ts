import type { HindsightClient } from '../client.js';
import type { ResolvedConfig, PluginConfig, PluginHookAgentContext } from '../types.js';
import type { DiscoveryResult, ResolvedPermissions } from '../permissions/types.js';
import { resolvePermissions } from '../permissions/resolver.js';
import { debug } from '../debug.js';
import { deriveBankId } from '../derive-bank-id.js';
import { stripMemoryTags, stripMetadataEnvelopes, sliceLastTurnsByUserBoundary, extractTopicId } from '../utils.js';

// Re-export for backward compatibility
export { stripMemoryTags } from '../utils.js';

// ── Module-level state for chunked retention (C2/C5) ────────────────
// Track turns per session for retainEveryNTurns support.
// Ported from native index.ts line 34.
const turnCountBySession = new Map<string, number>();
const MAX_TRACKED_SESSIONS = 10_000;

/** Clear module-level state. Called by service.stop() to prevent stale data after reinit. */
export function resetRetainState(): void {
  turnCountBySession.clear();
}

/**
 * Extract text content from message content (handles string and Array<{type:'text', text:string}>).
 * Ported from native index.ts lines 1334-1342.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');
  }
  return '';
}

/**
 * Prepare a retention transcript from messages.
 * Ported from native index.ts lines 1292-1359.
 *
 * Key differences from our old implementation:
 * - Finds last user message index and retains only from there (unless retainFullWindow)
 * - Uses `[role: user]\ncontent\n[user:end]` format (not `user: content`)
 * - Calls stripMemoryTags() AND stripMetadataEnvelopes() on each message
 * - Returns `{ transcript, messageCount } | null`
 * - Rejects transcripts < 10 chars
 */
export function prepareRetentionTranscript(
  messages: any[],
  retainRoles: string[],
  retainFullWindow = false,
): { transcript: string; messageCount: number } | null {
  if (!messages || messages.length === 0) {
    return null;
  }

  let targetMessages: any[];
  if (retainFullWindow) {
    // Chunked retention: retain the full sliding window (already sliced by caller)
    targetMessages = messages;
  } else {
    // Default: retain only the last turn (user message + assistant responses)
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) {
      return null; // No user message found in turn
    }
    targetMessages = messages.slice(lastUserIdx);
  }

  // Role filtering
  const allowedRoles = new Set(retainRoles);
  const filteredMessages = targetMessages.filter((m: any) => allowedRoles.has(m.role));

  if (filteredMessages.length === 0) {
    return null;
  }

  // Format messages into a transcript using native format: [role: X]\ncontent\n[X:end]
  const transcriptParts = filteredMessages
    .map((msg: any) => {
      const role = msg.role || 'unknown';
      let content = '';

      // Handle different content formats (string AND Array<{type:'text', text:string}>)
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('\n');
      }

      // Strip plugin-injected memory tags and metadata envelopes to prevent feedback loop
      content = stripMemoryTags(content);
      content = stripMetadataEnvelopes(content);

      return content.trim() ? `[role: ${role}]\n${content}\n[${role}:end]` : null;
    })
    .filter(Boolean);

  const transcript = transcriptParts.join('\n\n');

  if (!transcript.trim() || transcript.length < 10) {
    return null; // Transcript too short
  }

  return { transcript, messageCount: transcriptParts.length };
}

/**
 * Handle the retain hook — supports chunked retention with turn counting.
 *
 * Ported from native index.ts lines 1162-1279.
 */
export async function handleRetain(
  event: any,
  ctx: PluginHookAgentContext | undefined,
  agentConfig: ResolvedConfig,
  client: HindsightClient,
  pluginConfig: PluginConfig,
  discovery: DiscoveryResult | null = null,
): Promise<void> {
  const bankId = deriveBankId(ctx, pluginConfig);
  debug(`[Hindsight Hook] agent_end triggered - bank: ${bankId}`);

  // ── Per-user permission resolution (v2.0.0) ──
  let permissions: ResolvedPermissions | null = null;
  if (discovery) {
    const provider = ctx?.messageProvider ?? 'unknown';
    const sid = ctx?.senderId ?? 'unknown';
    const channelKey = `${provider}:${sid}`;
    permissions = resolvePermissions(channelKey, bankId, discovery);

    if (!permissions.retain) {
      debug(`[Hindsight Hook] Retain: skipped (retain=false for ${permissions.displayName} on ${bankId})`);
      return;
    }

    if (permissions.excludeProviders?.includes(ctx?.messageProvider ?? '')) {
      debug(`[Hindsight Hook] Retain: provider "${ctx?.messageProvider}" excluded for ${permissions.displayName}`);
      return;
    }
  }

  if (agentConfig.autoRetain === false && !discovery) {
    debug('[Hindsight Hook] autoRetain is disabled, skipping retention');
    return;
  }

  const allMessages = event?.context?.sessionEntry?.messages ?? event?.messages ?? [];
  if (!allMessages.length) {
    debug('[Hindsight Hook] No messages in event, skipping retention');
    return;
  }

  const retainRoles = permissions?.retainRoles ?? agentConfig.retainRoles ?? ['user', 'assistant'];

  // ── Chunked retention (C2/C5) ──────────────────────────────────────
  // Skip non-Nth turns and use a sliding window when firing.
  // Ported from native index.ts lines 1200-1231.
  const retainEveryN = permissions?.retainEveryNTurns ?? agentConfig.retainEveryNTurns ?? pluginConfig.retainEveryNTurns ?? 1;
  let messagesToRetain = allMessages;
  let retainFullWindow = false;

  if (retainEveryN > 1) {
    const sessionTrackingKey = `${bankId}:${ctx?.sessionKey || 'session'}`;
    const turnCount = (turnCountBySession.get(sessionTrackingKey) || 0) + 1;
    turnCountBySession.set(sessionTrackingKey, turnCount);
    if (turnCountBySession.size > MAX_TRACKED_SESSIONS) {
      const oldestKey = turnCountBySession.keys().next().value;
      if (oldestKey) {
        turnCountBySession.delete(oldestKey);
      }
    }

    if (turnCount % retainEveryN !== 0) {
      const nextRetainAt = Math.ceil(turnCount / retainEveryN) * retainEveryN;
      debug(`[Hindsight Hook] Turn ${turnCount}/${retainEveryN}, skipping retain (next at turn ${nextRetainAt})`);
      return; // Skip non-Nth turn
    }

    // Sliding window in turns: N turns + configured overlap turns.
    const overlapTurns = agentConfig.retainOverlapTurns ?? pluginConfig.retainOverlapTurns ?? 0;
    const windowTurns = retainEveryN + overlapTurns;
    messagesToRetain = sliceLastTurnsByUserBoundary(allMessages, windowTurns);
    retainFullWindow = true;
    debug(`[Hindsight Hook] Turn ${turnCount}: chunked retain firing (window: ${windowTurns} turns, ${messagesToRetain.length} messages)`);
  }

  const retention = prepareRetentionTranscript(messagesToRetain, retainRoles, retainFullWindow);
  if (!retention) {
    debug('[Hindsight Hook] No messages to retain (filtered/short/no-user)');
    return;
  }

  const { transcript, messageCount } = retention;
  const documentId = `session-${ctx?.sessionKey ?? 'unknown'}-${Date.now()}`;

  // Resolve topic-based strategy (discovery or legacy _topicIndex)
  const topicId = extractTopicId(ctx?.sessionKey);
  let strategy: string | undefined;

  if (discovery && topicId) {
    strategy = discovery.strategyIndex.get(`${bankId}:${topicId}`);
  } else {
    const topicEntry = topicId ? agentConfig._topicIndex?.get(topicId) : undefined;
    const effectiveMode = topicEntry?.mode ?? agentConfig._defaultMode ?? 'full';

    if (effectiveMode === 'disabled' || effectiveMode === 'recall') {
      debug(`[Hindsight Hook] Mode "${effectiveMode}" for topic ${topicId ?? 'default'} — skipping retain`);
      return;
    }
    strategy = topicEntry?.strategy;
  }
  if (strategy) {
    debug(`[Hindsight Hook] Topic ${topicId} → strategy "${strategy}"`);
  }

  debug(`[Hindsight] Retaining to bank ${bankId}, document: ${documentId}, chars: ${transcript.length}${strategy ? `, strategy: ${strategy}` : ''}\n---\n${transcript.substring(0, 500)}${transcript.length > 500 ? '\n...(truncated)' : ''}\n---`);

  // Merge tags: permission-level (includes user: tag + group retainTags) + bank-level
  const retainTags = permissions
    ? [...new Set([...(permissions.retainTags ?? []), ...(agentConfig.retainTags ?? [])])]
    : agentConfig.retainTags;

  await client.retain(bankId, {
    items: [{
      content: transcript,
      document_id: documentId,
      metadata: {
        retained_at: new Date().toISOString(),
        message_count: String(messageCount),
        channel_type: ctx?.messageProvider ?? '',
        channel_id: ctx?.channelId ?? '',
        sender_id: ctx?.senderId ?? '',
      },
      tags: retainTags,
      context: agentConfig.retainContext,
      observation_scopes: agentConfig.retainObservationScopes,
      strategy,
    }],
    async: true,
  });

  debug(`[Hindsight] Retained ${messageCount} messages to bank ${bankId} for session ${documentId}`);
}
