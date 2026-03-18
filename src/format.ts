import type { MemoryResult } from './types.js';

export const DEFAULT_RECALL_PROMPT_PREAMBLE =
  'Relevant memories from past conversations (prioritize recent when conflicting). Only use memories that are directly useful to continue this conversation; ignore the rest:';

export function formatCurrentTimeForRecall(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function formatMemories(results: MemoryResult[]): string {
  if (!results || results.length === 0) return '';
  return results
    .map(r => {
      const type = r.type ? ` [${r.type}]` : '';
      const date = r.mentioned_at ? ` (${r.mentioned_at})` : '';
      return `- ${r.text}${type}${date}`;
    })
    .join('\n\n');
}
