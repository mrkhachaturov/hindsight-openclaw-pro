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
import { deriveBankId } from '../derive-bank-id.js';
import { formatMemories, formatCurrentTimeForRecall, DEFAULT_RECALL_PROMPT_PREAMBLE } from '../format.js';

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
 * Extract a recall query from a hook event.
 * Prefers rawMessage (clean user text), falls back to prompt.
 */
function extractQuery(event: any): string | undefined {
  const raw = event?.rawMessage;
  if (raw && typeof raw === 'string' && raw.trim().length >= 5) {
    return raw.trim();
  }
  const prompt = event?.prompt;
  if (prompt && typeof prompt === 'string' && prompt.trim().length >= 5) {
    return prompt.trim();
  }
  return undefined;
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
  // 1. Extract query
  const query = extractQuery(event);
  if (!query) return undefined;

  // 2. Determine primary bank and recall-from banks
  const primaryBankId = deriveBankId(ctx, pluginConfig);
  const recallFrom = agentConfig._recallFrom;

  // 3. Build common recall params
  const tagGroups = resolveRecallFilter(agentConfig);
  const budget = agentConfig.recallBudget;
  const maxTokens = agentConfig.recallMaxTokens;
  const types = agentConfig.recallTypes;

  // 4. Reflect path — use reflect instead of recall on primary bank
  if (agentConfig._reflectOnRecall) {
    try {
      const response: ReflectResponse = await client.reflect(primaryBankId, {
        query,
        budget: agentConfig._reflectBudget ?? budget,
        max_tokens: agentConfig._reflectMaxTokens ?? maxTokens,
        tag_groups: tagGroups.length > 0 ? tagGroups : undefined,
      });
      if (!response.text) return undefined;
      const preamble = agentConfig.recallPromptPreamble ?? DEFAULT_RECALL_PROMPT_PREAMBLE;
      const timestamp = formatCurrentTimeForRecall();
      return `${preamble}\n[Current time: ${timestamp}]\n\n${response.text}`;
    } catch (error) {
      console.warn(`[Hindsight] Reflect failed for bank ${primaryBankId}:`, error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  // 5. Determine bank list
  const banks = recallFrom ?? [{ bankId: primaryBankId }];

  // 6. Single bank — straightforward recall
  if (banks.length === 1) {
    const bank = banks[0];
    try {
      const response: RecallResponse = await client.recall(bank.bankId, {
        query,
        budget: bank.budget ?? budget,
        max_tokens: bank.maxTokens ?? maxTokens,
        types: bank.types ?? types,
        tag_groups: (bank.tagGroups ?? tagGroups).length > 0 ? (bank.tagGroups ?? tagGroups) : undefined,
      });
      if (!response.results?.length) return undefined;
      return formatRecallOutput(response.results, agentConfig);
    } catch (error) {
      console.warn(`[Hindsight] Recall failed for bank ${bank.bankId}:`, error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  // 7. Multi-bank — parallel recall + interleave
  const results = await Promise.allSettled(
    banks.map(bank =>
      client.recall(bank.bankId, {
        query,
        budget: bank.budget ?? budget,
        max_tokens: bank.maxTokens ?? maxTokens,
        types: bank.types ?? types,
        tag_groups: (bank.tagGroups ?? tagGroups).length > 0 ? (bank.tagGroups ?? tagGroups) : undefined,
      }),
    ),
  );

  const successSets: MemoryResult[][] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled' && result.value.results?.length) {
      successSets.push(result.value.results);
    } else if (result.status === 'rejected') {
      const bankId = banks[i].bankId;
      console.warn(`[Hindsight] Recall failed for bank ${bankId}:`, result.reason instanceof Error ? result.reason.message : result.reason);
    }
  }

  if (successSets.length === 0) return undefined;

  const merged = interleaveResults(successSets);
  return formatRecallOutput(merged, agentConfig);
}

/**
 * Format recall results with preamble and timestamp.
 */
function formatRecallOutput(results: MemoryResult[], agentConfig: ResolvedConfig): string | undefined {
  const formatted = formatMemories(results);
  if (!formatted) return undefined;
  const preamble = agentConfig.recallPromptPreamble ?? DEFAULT_RECALL_PROMPT_PREAMBLE;
  const timestamp = formatCurrentTimeForRecall();
  return `${preamble}\n[Current time: ${timestamp}]\n\n${formatted}`;
}
