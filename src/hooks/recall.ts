import { createHash } from 'crypto';
import type {
  PluginHookAgentContext,
  PluginConfig,
  ResolvedConfig,
  TagGroup,
  MemoryResult,
  RecallResponse,
  ReflectResponse,
} from '../types.js';
import type { HindsightClient } from '../client.js';
import { debug } from '../debug.js';
import { deriveBankId } from '../derive-bank-id.js';
import { formatMemories, formatCurrentTimeForRecall, DEFAULT_RECALL_PROMPT_PREAMBLE } from '../format.js';
import {
  extractRecallQuery,
  composeRecallQuery,
  truncateRecallQuery,
  stripMetadataEnvelopes,
  stripMemoryTags,
  sliceLastTurnsByUserBoundary,
  extractTopicId,
} from '../utils.js';

// Re-export utilities for backward compatibility and testing
export {
  extractRecallQuery,
  composeRecallQuery,
  truncateRecallQuery,
} from '../utils.js';

const RECALL_TIMEOUT_MS = 10_000;

// ── In-flight recall deduplication (I1) ─────────────────────────────
// Concurrent recalls for the same bank+query hash reuse one promise.
// Ported from native index.ts lines 31-33.
const inflightRecalls = new Map<string, Promise<RecallResponse>>();

/** Clear module-level state. Called by service.stop() to prevent stale data after reinit. */
export function resetRecallState(): void {
  inflightRecalls.clear();
}

/**
 * Convert agent-level recallTags + recallTagsMatch into a tag_groups filter.
 */
export function resolveRecallFilter(agentConfig: ResolvedConfig): TagGroup[] {
  const tags = agentConfig.recallTags;
  const match = agentConfig.recallTagsMatch ?? 'any';
  if (!tags?.length) return [];
  return [{ tags, match }];
}

/**
 * Round-robin interleave results from multiple bank recall sets.
 * Takes one result from each set in turn, handling uneven lengths.
 */
export function interleaveResults(resultSets: MemoryResult[][]): MemoryResult[] {
  const result: MemoryResult[] = [];
  const maxLen = Math.max(...resultSets.map(s => s.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const set of resultSets) {
      if (i < set.length) result.push(set[i]);
    }
  }
  return result;
}

/**
 * Handle the recall hook — supports single-bank, multi-bank, and reflect paths.
 *
 * Returns a formatted memory string to prepend to the agent context,
 * or undefined if no relevant memories were found.
 */
export async function handleRecall(
  event: any,
  ctx: PluginHookAgentContext | undefined,
  agentConfig: ResolvedConfig,
  client: HindsightClient,
  pluginConfig: PluginConfig,
): Promise<string | undefined> {
  // 1. Determine primary bank
  const primaryBankId = deriveBankId(ctx, pluginConfig);

  // Memory mode gating
  const topicId = extractTopicId(ctx?.sessionKey);
  const topicEntry = topicId ? agentConfig._topicIndex?.get(topicId) : undefined;
  const effectiveMode = topicEntry?.mode ?? agentConfig._defaultMode ?? 'full';

  if (effectiveMode === 'disabled') {
    debug(`[Hindsight] Mode "disabled" for topic ${topicId ?? 'default'} — skipping recall`);
    return undefined;
  }

  debug(`[Hindsight] before_prompt_build - bank: ${primaryBankId}, channel: ${ctx?.messageProvider}/${ctx?.channelId}`);
  debug(`[Hindsight] event keys: ${Object.keys(event ?? {}).join(', ')}`);
  debug(`[Hindsight] event.context keys: ${Object.keys(event?.context ?? {}).join(', ')}`);

  // 2. Extract query using full native pipeline (C1)
  debug(`[Hindsight] extractRecallQuery input lengths - raw: ${event?.rawMessage?.length ?? 0}, prompt: ${event?.prompt?.length ?? 0}`);
  const extracted = extractRecallQuery(event?.rawMessage, event?.prompt);
  if (!extracted) {
    debug('[Hindsight] extractRecallQuery returned null, skipping recall');
    return undefined;
  }
  debug(`[Hindsight] extractRecallQuery result length: ${extracted.length}`);

  // 3. Compose multi-turn query from session messages
  const recallContextTurns = agentConfig.recallContextTurns ?? pluginConfig.recallContextTurns ?? 1;
  const recallMaxQueryChars = agentConfig.recallMaxQueryChars ?? pluginConfig.recallMaxQueryChars ?? 800;
  const recallRoles = agentConfig.recallRoles ?? pluginConfig.recallRoles ?? ['user', 'assistant'];
  const sessionMessages = event?.context?.sessionEntry?.messages ?? event?.messages ?? [];

  const messageCount = sessionMessages.length;
  debug(`[Hindsight] event.messages count: ${messageCount}, roles: ${sessionMessages.map((m: any) => m.role).join(',')}`);
  if (recallContextTurns > 1 && messageCount === 0) {
    debug('[Hindsight] recallContextTurns > 1 but event.messages is empty — prior context unavailable at before_agent_start for this provider');
  }

  const composedQuery = composeRecallQuery(extracted, sessionMessages, recallContextTurns, recallRoles);
  let query = truncateRecallQuery(composedQuery, extracted, recallMaxQueryChars);

  // Final defensive cap (matches native)
  if (query.length > recallMaxQueryChars) {
    query = query.substring(0, recallMaxQueryChars);
  }

  // 4. Determine recall-from banks
  const recallFrom = agentConfig._recallFrom;

  // 5. Build common recall params
  const tagGroups = resolveRecallFilter(agentConfig);
  const budget = agentConfig.recallBudget;
  const maxTokens = agentConfig.recallMaxTokens;
  const types = agentConfig.recallTypes;
  const topK = agentConfig.recallTopK;

  // 6. Reflect path — use reflect instead of recall on primary bank
  if (agentConfig._reflectOnRecall) {
    debug(`[Hindsight] Reflect path for bank ${primaryBankId}, query:\n---\n${query}\n---`);
    try {
      const response: ReflectResponse = await client.reflect(primaryBankId, {
        query,
        budget: agentConfig._reflectBudget ?? budget,
        max_tokens: agentConfig._reflectMaxTokens ?? maxTokens,
        tag_groups: tagGroups.length > 0 ? tagGroups : undefined,
      });
      if (!response.text) {
        debug('[Hindsight] Reflect returned empty text, skipping memory injection');
        return undefined;
      }
      debug(`[Hindsight] Reflect response length: ${response.text.length} chars`);
      // Wrap in <hindsight_memories> tags (I4)
      const preamble = agentConfig.recallPromptPreamble ?? DEFAULT_RECALL_PROMPT_PREAMBLE;
      const timestamp = formatCurrentTimeForRecall();
      return `<hindsight_memories>\n${preamble}\nCurrent time - ${timestamp}\n\n${response.text}\n</hindsight_memories>`;
    } catch (error) {
      // I5: Timeout-specific error handling
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        console.warn(`[Hindsight] Reflect timed out, skipping memory injection`);
      } else if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`[Hindsight] Reflect aborted, skipping memory injection`);
      } else {
        console.warn(`[Hindsight] Reflect failed for bank ${primaryBankId}:`, error instanceof Error ? error.message : error);
      }
      return undefined;
    }
  }

  // 7. Determine bank list
  const banks = recallFrom ?? [{ bankId: primaryBankId }];

  debug(`[Hindsight] Auto-recall for bank ${banks.map(b => b.bankId).join(', ')}, full query:\n---\n${query}\n---`);

  // 8. Single bank — straightforward recall with deduplication (I1)
  if (banks.length === 1) {
    const bank = banks[0];
    try {
      const response = await recallWithDedup(
        client,
        bank.bankId,
        {
          query,
          budget: bank.budget ?? budget,
          max_tokens: bank.maxTokens ?? maxTokens,
          types: bank.types ?? types,
          tag_groups: (bank.tagGroups ?? tagGroups).length > 0 ? (bank.tagGroups ?? tagGroups) : undefined,
        },
      );
      if (!response.results?.length) {
        debug('[Hindsight] No memories found for auto-recall');
        return undefined;
      }
      debug(`[Hindsight] Raw recall response (${response.results.length} results before topK):\n${response.results.map((r: any, i: number) => `  [${i}] score=${r.score?.toFixed(3) ?? 'n/a'} type=${r.type ?? 'n/a'}: ${JSON.stringify(r.content ?? r.text ?? r).substring(0, 200)}`).join('\n')}`);
      const results = topK ? response.results.slice(0, topK) : response.results;
      debug(`[Hindsight] After topK (${topK ?? 'unlimited'}): ${results.length} results injected`);
      const output = formatRecallOutput(results, agentConfig);
      if (output) {
        debug(`[Hindsight] Auto-recall: Injecting ${results.length} memories from bank ${bank.bankId}`);
      }
      return output;
    } catch (error) {
      // I5: Timeout-specific error handling
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        console.warn(`[Hindsight] Recall timed out after ${RECALL_TIMEOUT_MS}ms for bank ${bank.bankId}, skipping memory injection`);
      } else if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`[Hindsight] Recall aborted after ${RECALL_TIMEOUT_MS}ms for bank ${bank.bankId}, skipping memory injection`);
      } else {
        console.warn(`[Hindsight] Recall failed for bank ${bank.bankId}:`, error instanceof Error ? error.message : error);
      }
      return undefined;
    }
  }

  // 9. Multi-bank — parallel recall + interleave (with dedup)
  debug(`[Hindsight] Multi-bank recall across ${banks.length} banks: ${banks.map(b => b.bankId).join(', ')}`);
  const results = await Promise.allSettled(
    banks.map(bank =>
      recallWithDedup(
        client,
        bank.bankId,
        {
          query,
          budget: bank.budget ?? budget,
          max_tokens: bank.maxTokens ?? maxTokens,
          types: bank.types ?? types,
          tag_groups: (bank.tagGroups ?? tagGroups).length > 0 ? (bank.tagGroups ?? tagGroups) : undefined,
        },
      ),
    ),
  );

  const successSets: MemoryResult[][] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled' && result.value.results?.length) {
      debug(`[Hindsight] Bank ${banks[i].bankId}: ${result.value.results.length} results`);
      successSets.push(result.value.results);
    } else if (result.status === 'rejected') {
      const bankId = banks[i].bankId;
      console.warn(`[Hindsight] Recall failed for bank ${bankId}:`, result.reason instanceof Error ? result.reason.message : result.reason);
    } else if (result.status === 'fulfilled') {
      debug(`[Hindsight] Bank ${banks[i].bankId}: no results`);
    }
  }

  if (successSets.length === 0) {
    debug('[Hindsight] No memories found for auto-recall (all banks empty)');
    return undefined;
  }

  const merged = interleaveResults(successSets);
  debug(`[Hindsight] Multi-bank merged: ${merged.length} total results from ${successSets.length} banks`);
  const output = formatRecallOutput(merged, agentConfig);
  if (output) {
    debug(`[Hindsight] Auto-recall: Injecting ${merged.length} memories from ${successSets.length} banks`);
  }
  return output;
}

/**
 * Recall with in-flight deduplication (I1).
 * Concurrent recalls for the same bank+query hash reuse one promise.
 * Ported from native index.ts lines 1107-1118.
 */
async function recallWithDedup(
  client: HindsightClient,
  bankId: string,
  request: { query: string; budget?: 'low' | 'mid' | 'high'; max_tokens?: number; types?: Array<'world' | 'experience' | 'observation'>; tag_groups?: TagGroup[] },
): Promise<RecallResponse> {
  const normalizedQuery = request.query.trim().toLowerCase().replace(/\s+/g, ' ');
  const queryHash = createHash('sha256').update(normalizedQuery).digest('hex').slice(0, 16);
  const recallKey = `${bankId}::${queryHash}`;

  const existing = inflightRecalls.get(recallKey);
  if (existing) {
    debug(`[Hindsight] Reusing in-flight recall for bank ${bankId}`);
    return existing;
  }

  const recallPromise = client.recall(bankId, request, RECALL_TIMEOUT_MS);
  inflightRecalls.set(recallKey, recallPromise);
  void recallPromise.catch(() => {}).finally(() => inflightRecalls.delete(recallKey));

  return recallPromise;
}

/**
 * Format recall results wrapped in <hindsight_memories> tags (I4).
 * Native wraps in: <hindsight_memories>\n{content}\n</hindsight_memories>.
 * This prevents the feedback loop where recalled memories get re-retained.
 */
function formatRecallOutput(results: MemoryResult[], agentConfig: ResolvedConfig): string | undefined {
  const formatted = formatMemories(results);
  if (!formatted) return undefined;
  const preamble = agentConfig.recallPromptPreamble ?? DEFAULT_RECALL_PROMPT_PREAMBLE;
  const timestamp = formatCurrentTimeForRecall();
  return `<hindsight_memories>\n${preamble}\nCurrent time - ${timestamp}\n\n${formatted}\n</hindsight_memories>`;
}
