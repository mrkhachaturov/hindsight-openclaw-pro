/**
 * Shared utility functions ported from native hindsight-openclaw plugin.
 * These MUST stay in sync with the upstream vendor implementation.
 */

// ── stripMetadataEnvelopes (C3) ──────────────────────────────────────
/**
 * Strip OpenClaw sender/conversation metadata envelopes from message content.
 * These blocks are injected by OpenClaw but are noise for memory storage and recall.
 *
 * Ported from native index.ts lines 231-237.
 */
export function stripMetadataEnvelopes(content: string): string {
  // Strip: ---\n<Label> (untrusted metadata):\n```json\n{...}\n```\n<message>\n---
  content = content.replace(/^---\n[\w\s]+\(untrusted metadata\)[^\n]*\n```json[\s\S]*?```\n\n?/im, '').replace(/\n---$/, '');
  // Strip: <Label> (untrusted metadata):\n```json\n{...}\n```  (without --- wrapper)
  content = content.replace(/[\w\s]+\(untrusted metadata\)[^\n]*\n```json[\s\S]*?```\n?/gim, '');
  return content.trim();
}

// ── stripMemoryTags (C4) ─────────────────────────────────────────────
/**
 * Strip plugin-injected memory tags from content to prevent retain feedback loop.
 * Removes <hindsight_memories>, <relevant_memories>, and <hindsight_context> blocks.
 *
 * Native strips: <hindsight_memories>, <relevant_memories>.
 * Our plugin additionally strips: <hindsight_context>.
 */
export function stripMemoryTags(content: string): string {
  content = content.replace(/<hindsight_memories>[\s\S]*?<\/hindsight_memories>/g, '');
  content = content.replace(/<relevant_memories>[\s\S]*?<\/relevant_memories>/g, '');
  content = content.replace(/<hindsight_context>[\s\S]*?<\/hindsight_context>/g, '');
  return content;
}

// ── sliceLastTurnsByUserBoundary ─────────────────────────────────────
/**
 * Slice messages to the last N turns, where a "turn" starts at a user message.
 * Ported from native index.ts lines 1361-1384.
 */
export function sliceLastTurnsByUserBoundary(messages: any[], turns: number): any[] {
  if (!Array.isArray(messages) || messages.length === 0 || turns <= 0) {
    return [];
  }

  let userTurnsSeen = 0;
  let startIndex = -1;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      userTurnsSeen += 1;
      if (userTurnsSeen >= turns) {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex === -1) {
    return messages;
  }

  return messages.slice(startIndex);
}

// ── extractRecallQuery (C1) ──────────────────────────────────────────
/**
 * Extract a recall query from a hook event's rawMessage or prompt.
 *
 * Prefers rawMessage (clean user text). Falls back to prompt, stripping
 * envelope formatting (System: lines, [Channel ...] headers, [from: X] footers).
 *
 * Returns null when no usable query (< 5 chars) can be extracted.
 *
 * Ported from native index.ts lines 247-307.
 */
export function extractRecallQuery(
  rawMessage: string | undefined,
  prompt: string | undefined,
): string | null {
  // Reject known metadata/system message patterns — these are not user queries
  const METADATA_PATTERNS = [
    /^\s*conversation info\s*\(untrusted metadata\)/i,
    /^\s*\(untrusted metadata\)/i,
    /^\s*system:/i,
  ];
  const isMetadata = (s: string) => METADATA_PATTERNS.some(p => p.test(s));

  let recallQuery = rawMessage;
  // Strip sender metadata envelope before any checks
  if (recallQuery) {
    recallQuery = stripMetadataEnvelopes(recallQuery);
  }
  if (!recallQuery || typeof recallQuery !== 'string' || recallQuery.trim().length < 5 || isMetadata(recallQuery)) {
    recallQuery = prompt;
    // Strip metadata envelopes from prompt too, then check if anything useful remains
    if (recallQuery) {
      recallQuery = stripMetadataEnvelopes(recallQuery);
    }
    if (!recallQuery || recallQuery.length < 5) {
      return null;
    }

    // Strip envelope-formatted prompts from any channel
    let cleaned = recallQuery;

    // Remove leading "System: ..." lines (from prependSystemEvents)
    cleaned = cleaned.replace(/^(?:System:.*\n)+\n?/, '');

    // Remove session abort hint
    cleaned = cleaned.replace(
      /^Note: The previous agent run was aborted[^\n]*\n\n/,
      '',
    );

    // Extract message after [ChannelName ...] envelope header
    const envelopeMatch = cleaned.match(
      /\[[A-Z][A-Za-z]*(?:\s[^\]]+)?\]\s*([\s\S]+)$/,
    );
    if (envelopeMatch) {
      cleaned = envelopeMatch[1];
    }

    // Remove trailing [from: SenderName] metadata (group chats)
    cleaned = cleaned.replace(/\n\[from:[^\]]*\]\s*$/, '');

    // Strip metadata envelopes again after channel envelope extraction, in case
    // the metadata block appeared after the [ChannelName] header
    cleaned = stripMetadataEnvelopes(cleaned);

    recallQuery = cleaned.trim() || recallQuery;
  }

  const trimmed = recallQuery.trim();
  if (trimmed.length < 5 || isMetadata(trimmed)) return null;
  return trimmed;
}

// ── composeRecallQuery (C1) ──────────────────────────────────────────
/**
 * Compose a multi-turn recall query from the latest query and prior context.
 * Ported from native index.ts lines 309-360.
 */
export function composeRecallQuery(
  latestQuery: string,
  messages: any[] | undefined,
  recallContextTurns: number,
  recallRoles: Array<'user' | 'assistant' | 'system' | 'tool'> = ['user', 'assistant'],
): string {
  const latest = latestQuery.trim();
  if (recallContextTurns <= 1 || !Array.isArray(messages) || messages.length === 0) {
    return latest;
  }

  const allowedRoles = new Set(recallRoles);
  const contextualMessages = sliceLastTurnsByUserBoundary(messages, recallContextTurns);
  const contextLines = contextualMessages
    .map((msg: any) => {
      const role = msg?.role;
      if (!allowedRoles.has(role)) {
        return null;
      }

      let content = '';
      if (typeof msg?.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg?.content)) {
        content = msg.content
          .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
          .map((block: any) => block.text)
          .join('\n');
      }

      content = stripMemoryTags(content).trim();
      content = stripMetadataEnvelopes(content);
      if (!content) {
        return null;
      }
      if (role === 'user' && content === latest) {
        return null;
      }
      return `${role}: ${content}`;
    })
    .filter((line: string | null): line is string => Boolean(line));

  if (contextLines.length === 0) {
    return latest;
  }

  return [
    'Prior context:',
    contextLines.join('\n'),
    latest,
  ].join('\n\n');
}

// ── truncateRecallQuery (C1) ─────────────────────────────────────────
/**
 * Truncate a composed recall query to maxChars, preserving the latest query.
 * Ported from native index.ts lines 362-416.
 */
export function truncateRecallQuery(query: string, latestQuery: string, maxChars: number): string {
  if (maxChars <= 0) {
    return query;
  }

  const latest = latestQuery.trim();
  if (query.length <= maxChars) {
    return query;
  }

  const latestOnly = latest.length <= maxChars ? latest : latest.slice(0, maxChars);

  if (!query.includes('Prior context:')) {
    return latestOnly;
  }

  // New order: Prior context at top, latest user message at bottom.
  // Truncate by dropping oldest context lines first to preserve the suffix.
  const contextMarker = 'Prior context:\n\n';
  const markerIndex = query.indexOf(contextMarker);
  if (markerIndex === -1) {
    return latestOnly;
  }

  const suffixMarker = '\n\n' + latest;
  const suffixIndex = query.lastIndexOf(suffixMarker);
  if (suffixIndex === -1) {
    return latestOnly;
  }

  const suffix = query.slice(suffixIndex); // \n\n<latest>
  if (suffix.length >= maxChars) {
    return latestOnly;
  }

  const contextBody = query.slice(markerIndex + contextMarker.length, suffixIndex);
  const contextLines = contextBody.split('\n').filter(Boolean);
  const keptContextLines: string[] = [];

  // Add context lines from newest (bottom) to oldest (top), stopping when we exceed maxChars
  for (let i = contextLines.length - 1; i >= 0; i--) {
    keptContextLines.unshift(contextLines[i]);
    const candidate = `${contextMarker}${keptContextLines.join('\n')}${suffix}`;
    if (candidate.length > maxChars) {
      keptContextLines.shift();
      break;
    }
  }

  if (keptContextLines.length > 0) {
    return `${contextMarker}${keptContextLines.join('\n')}${suffix}`;
  }

  return latestOnly;
}

// ── extractTopicId ────────────────────────────────────────────────────
/**
 * Extract the topic thread ID from a session key.
 * DM topics: "agent:yoda:main:thread:276243527:280475" → "280475"
 * Group topics: "agent:yoda:telegram:group:-100xxx:topic:42" → "42"
 */
export function extractTopicId(sessionKey: string | undefined): string | undefined {
  if (!sessionKey) return undefined;
  // DM topic: ...thread:{userId}:{topicId}
  const threadMatch = sessionKey.match(/:thread:\d+:(\d+)$/);
  if (threadMatch) return threadMatch[1];
  // Group forum topic: ...topic:{topicId}
  const topicMatch = sessionKey.match(/:topic:(\d+)$/);
  if (topicMatch) return topicMatch[1];
  return undefined;
}
