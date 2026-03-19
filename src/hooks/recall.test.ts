import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRecallFilter, interleaveResults, handleRecall, extractRecallQuery, composeRecallQuery, truncateRecallQuery } from './recall.js';
import type { ResolvedConfig, MemoryResult, PluginConfig, PluginHookAgentContext, RecallResponse, ReflectResponse } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeMemory(id: string, text: string, type = 'world'): MemoryResult {
  return {
    id,
    text,
    type,
    entities: [],
    context: '',
    occurred_start: null,
    occurred_end: null,
    mentioned_at: null,
    document_id: null,
    metadata: null,
    chunk_id: null,
    tags: [],
  };
}

function makeClient() {
  return {
    recall: vi.fn<(bankId: string, request: any, timeout?: number) => Promise<RecallResponse>>(),
    reflect: vi.fn<(bankId: string, request: any) => Promise<ReflectResponse>>(),
    // Stubs for unused client methods
    httpMode: true,
    retain: vi.fn(),
    getBankConfig: vi.fn(),
    updateBankConfig: vi.fn(),
    resetBankConfig: vi.fn(),
    listDirectives: vi.fn(),
    createDirective: vi.fn(),
    updateDirective: vi.fn(),
    deleteDirective: vi.fn(),
    getMentalModel: vi.fn(),
    listMentalModels: vi.fn(),
    listTags: vi.fn(),
  } as any;
}

const baseAgentConfig: ResolvedConfig = {
  autoRecall: true,
  recallBudget: 'mid',
  recallMaxTokens: 2048,
};

const basePluginConfig: PluginConfig = {
  dynamicBankId: true,
};

const baseCtx: PluginHookAgentContext = {
  agentId: 'yoda',
  channelId: 'chan-1',
  senderId: 'user-1',
};

// ── extractRecallQuery (C1) ──────────────────────────────────────────

describe('extractRecallQuery', () => {
  it('prefers rawMessage over prompt', () => {
    expect(extractRecallQuery('hello world', 'fallback prompt')).toBe('hello world');
  });

  it('falls back to prompt when rawMessage is too short', () => {
    expect(extractRecallQuery('hi', 'a longer prompt query')).toBe('a longer prompt query');
  });

  it('returns null when both are too short', () => {
    expect(extractRecallQuery('hi', 'abc')).toBeNull();
  });

  it('strips metadata envelopes from rawMessage', () => {
    const raw = 'Sender (untrusted metadata):\n```json\n{"id":"u1"}\n```\nActual question here';
    expect(extractRecallQuery(raw, undefined)).toBe('Actual question here');
  });

  it('strips System: lines from prompt', () => {
    const prompt = 'System: event happened\n\nWhat should I do about this?';
    expect(extractRecallQuery(undefined, prompt)).toBe('What should I do about this?');
  });

  it('strips session abort hint from prompt', () => {
    const prompt = 'Note: The previous agent run was aborted due to timeout.\n\nContinue the task';
    expect(extractRecallQuery(undefined, prompt)).toBe('Continue the task');
  });

  it('extracts content after [Channel] envelope header', () => {
    const prompt = '[Telegram Group Chat] tell me about the project';
    expect(extractRecallQuery(undefined, prompt)).toBe('tell me about the project');
  });

  it('strips trailing [from: SenderName] metadata', () => {
    const prompt = '[Telegram] What is the status\n[from: John]';
    expect(extractRecallQuery(undefined, prompt)).toBe('What is the status');
  });

  it('rejects metadata-only messages', () => {
    expect(extractRecallQuery('conversation info (untrusted metadata)...', undefined)).toBeNull();
    expect(extractRecallQuery('System: something happened', undefined)).toBeNull();
  });

  it('returns null for undefined inputs', () => {
    expect(extractRecallQuery(undefined, undefined)).toBeNull();
  });
});

// ── composeRecallQuery (C1) ──────────────────────────────────────────

describe('composeRecallQuery', () => {
  it('returns latest query when recallContextTurns is 1', () => {
    expect(composeRecallQuery('hello', [{ role: 'user', content: 'old' }], 1)).toBe('hello');
  });

  it('composes multi-turn query from session messages', () => {
    const messages = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' },
    ];
    const result = composeRecallQuery('second question', messages, 2);
    expect(result).toContain('Prior context:');
    expect(result).toContain('user: first question');
    expect(result).toContain('assistant: first answer');
    expect(result).toContain('second question');
  });

  it('skips context messages matching the latest query', () => {
    const messages = [
      { role: 'user', content: 'the same query' },
    ];
    const result = composeRecallQuery('the same query', messages, 2);
    expect(result).toBe('the same query');
  });

  it('filters by recallRoles', () => {
    const messages = [
      { role: 'user', content: 'user msg' },
      { role: 'system', content: 'system msg' },
      { role: 'assistant', content: 'asst msg' },
    ];
    const result = composeRecallQuery('latest', messages, 5, ['user']);
    expect(result).toContain('user: user msg');
    expect(result).not.toContain('system msg');
    expect(result).not.toContain('asst msg');
  });

  it('returns latest when no messages', () => {
    expect(composeRecallQuery('hello', undefined, 3)).toBe('hello');
    expect(composeRecallQuery('hello', [], 3)).toBe('hello');
  });
});

// ── truncateRecallQuery (C1) ─────────────────────────────────────────

describe('truncateRecallQuery', () => {
  it('returns query unchanged when under maxChars', () => {
    expect(truncateRecallQuery('short query', 'short query', 100)).toBe('short query');
  });

  it('returns latest-only when no prior context and over limit', () => {
    const long = 'a'.repeat(200);
    expect(truncateRecallQuery(long, 'latest', 50)).toBe('latest');
  });

  it('drops oldest context lines first to preserve latest', () => {
    const query = 'Prior context:\n\nuser: old line\nassistant: older line\n\nlatest question';
    const result = truncateRecallQuery(query, 'latest question', 60);
    expect(result).toContain('latest question');
  });

  it('returns query unchanged when maxChars is 0', () => {
    const query = 'any query';
    expect(truncateRecallQuery(query, 'any query', 0)).toBe('any query');
  });
});

// ── resolveRecallFilter ──────────────────────────────────────────────

describe('resolveRecallFilter', () => {
  it('returns empty array when no recallTags', () => {
    const config: ResolvedConfig = { ...baseAgentConfig };
    expect(resolveRecallFilter(config)).toEqual([]);
  });

  it('returns empty array when recallTags is empty', () => {
    const config: ResolvedConfig = { ...baseAgentConfig, recallTags: [] };
    expect(resolveRecallFilter(config)).toEqual([]);
  });

  it('converts recallTags to tag_groups leaf with default match=any', () => {
    const config: ResolvedConfig = { ...baseAgentConfig, recallTags: ['personal', 'work'] };
    expect(resolveRecallFilter(config)).toEqual([{ tags: ['personal', 'work'], match: 'any' }]);
  });

  it('uses recallTagsMatch from config', () => {
    const config: ResolvedConfig = { ...baseAgentConfig, recallTags: ['a', 'b'], recallTagsMatch: 'all' };
    expect(resolveRecallFilter(config)).toEqual([{ tags: ['a', 'b'], match: 'all' }]);
  });
});

// ── interleaveResults ────────────────────────────────────────────────

describe('interleaveResults', () => {
  it('interleaves from multiple sets (round-robin)', () => {
    const a = [makeMemory('a1', 'A1'), makeMemory('a2', 'A2')];
    const b = [makeMemory('b1', 'B1'), makeMemory('b2', 'B2')];
    const result = interleaveResults([a, b]);
    expect(result.map(r => r.id)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('handles sets of different lengths', () => {
    const a = [makeMemory('a1', 'A1'), makeMemory('a2', 'A2'), makeMemory('a3', 'A3')];
    const b = [makeMemory('b1', 'B1')];
    const result = interleaveResults([a, b]);
    expect(result.map(r => r.id)).toEqual(['a1', 'b1', 'a2', 'a3']);
  });

  it('handles empty sets', () => {
    const a = [makeMemory('a1', 'A1')];
    const result = interleaveResults([a, []]);
    expect(result.map(r => r.id)).toEqual(['a1']);
  });

  it('returns empty for all empty', () => {
    expect(interleaveResults([[], []])).toEqual([]);
    expect(interleaveResults([])).toEqual([]);
  });
});

// ── handleRecall ─────────────────────────────────────────────────────

describe('handleRecall', () => {
  let mockClient: ReturnType<typeof makeClient>;

  beforeEach(() => {
    mockClient = makeClient();
  });

  it('calls recall on single bank with correct params', async () => {
    const mem = makeMemory('m1', 'Hello world');
    mockClient.recall.mockResolvedValue({ results: [mem], entities: null, trace: null, chunks: null });

    const result = await handleRecall(
      { rawMessage: 'tell me about X' },
      baseCtx,
      baseAgentConfig,
      mockClient,
      basePluginConfig,
    );

    expect(mockClient.recall).toHaveBeenCalledOnce();
    const [bankId, request] = mockClient.recall.mock.calls[0];
    expect(bankId).toBe('yoda::chan-1::user-1');
    expect(request.query).toBe('tell me about X');
    expect(request.budget).toBe('mid');
    expect(request.max_tokens).toBe(2048);
    expect(result).toContain('Hello world');
  });

  it('wraps output in <hindsight_memories> tags (I4)', async () => {
    const mem = makeMemory('m1', 'Hello world');
    mockClient.recall.mockResolvedValue({ results: [mem], entities: null, trace: null, chunks: null });

    const result = await handleRecall(
      { rawMessage: 'tell me about X' },
      baseCtx,
      baseAgentConfig,
      mockClient,
      basePluginConfig,
    );

    expect(result).toMatch(/^<hindsight_memories>\n/);
    expect(result).toMatch(/<\/hindsight_memories>$/);
  });

  it('calls recall on multiple banks in parallel', async () => {
    const memA = makeMemory('a1', 'Memory from A');
    const memB = makeMemory('b1', 'Memory from B');
    mockClient.recall
      .mockResolvedValueOnce({ results: [memA], entities: null, trace: null, chunks: null })
      .mockResolvedValueOnce({ results: [memB], entities: null, trace: null, chunks: null });

    const config: ResolvedConfig = {
      ...baseAgentConfig,
      _recallFrom: [{ bankId: 'bank-a' }, { bankId: 'bank-b' }],
    };

    const result = await handleRecall(
      { rawMessage: 'multi bank query' },
      baseCtx,
      config,
      mockClient,
      basePluginConfig,
    );

    expect(mockClient.recall).toHaveBeenCalledTimes(2);
    expect(mockClient.recall.mock.calls[0][0]).toBe('bank-a');
    expect(mockClient.recall.mock.calls[1][0]).toBe('bank-b');
    expect(result).toContain('Memory from A');
    expect(result).toContain('Memory from B');
  });

  it('merges multi-bank results via interleave', async () => {
    const a1 = makeMemory('a1', 'A1');
    const a2 = makeMemory('a2', 'A2');
    const b1 = makeMemory('b1', 'B1');
    mockClient.recall
      .mockResolvedValueOnce({ results: [a1, a2], entities: null, trace: null, chunks: null })
      .mockResolvedValueOnce({ results: [b1], entities: null, trace: null, chunks: null });

    const config: ResolvedConfig = {
      ...baseAgentConfig,
      _recallFrom: [{ bankId: 'bank-a' }, { bankId: 'bank-b' }],
    };

    const result = await handleRecall(
      { rawMessage: 'interleave test' },
      baseCtx,
      config,
      mockClient,
      basePluginConfig,
    );

    // Interleaved order: a1, b1, a2 (wrapped in <hindsight_memories> tags)
    expect(result).toBeDefined();
    expect(result).toMatch(/^<hindsight_memories>\n/);
    expect(result).toMatch(/<\/hindsight_memories>$/);
    // Extract just the memory lines from inside the tags
    const inner = result!.replace(/<\/?hindsight_memories>/g, '').trim();
    const lines = inner.split('\n\n').filter(l => l.startsWith('- '));
    expect(lines).toEqual(['- A1 [world]', '- B1 [world]', '- A2 [world]']);
  });

  it('calls reflect when reflectOnRecall is true', async () => {
    mockClient.reflect.mockResolvedValue({
      text: 'Reflected insight about the topic',
      based_on: ['m1'],
    });

    const config: ResolvedConfig = {
      ...baseAgentConfig,
      _reflectOnRecall: true,
      _reflectBudget: 'high',
    };

    const result = await handleRecall(
      { rawMessage: 'reflect on this' },
      baseCtx,
      config,
      mockClient,
      basePluginConfig,
    );

    expect(mockClient.reflect).toHaveBeenCalledOnce();
    expect(mockClient.recall).not.toHaveBeenCalled();
    expect(result).toContain('Reflected insight about the topic');
    expect(result).toMatch(/^<hindsight_memories>\n/);
  });

  it('passes tag_groups from resolveRecallFilter', async () => {
    mockClient.recall.mockResolvedValue({ results: [makeMemory('m1', 'tagged')], entities: null, trace: null, chunks: null });

    const config: ResolvedConfig = {
      ...baseAgentConfig,
      recallTags: ['health', 'fitness'],
      recallTagsMatch: 'all',
    };

    await handleRecall(
      { rawMessage: 'tag filtered query' },
      baseCtx,
      config,
      mockClient,
      basePluginConfig,
    );

    const [, request] = mockClient.recall.mock.calls[0];
    expect(request.tag_groups).toEqual([{ tags: ['health', 'fitness'], match: 'all' }]);
  });

  it('returns undefined when no results', async () => {
    mockClient.recall.mockResolvedValue({ results: [], entities: null, trace: null, chunks: null });

    const result = await handleRecall(
      { rawMessage: 'empty query' },
      baseCtx,
      baseAgentConfig,
      mockClient,
      basePluginConfig,
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined when query is too short', async () => {
    const result = await handleRecall(
      { rawMessage: 'hi' },
      baseCtx,
      baseAgentConfig,
      mockClient,
      basePluginConfig,
    );

    expect(result).toBeUndefined();
    expect(mockClient.recall).not.toHaveBeenCalled();
  });

  it('falls back to event.prompt when rawMessage is missing', async () => {
    mockClient.recall.mockResolvedValue({ results: [makeMemory('m1', 'from prompt')], entities: null, trace: null, chunks: null });

    await handleRecall(
      { prompt: 'a longer prompt query' },
      baseCtx,
      baseAgentConfig,
      mockClient,
      basePluginConfig,
    );

    expect(mockClient.recall).toHaveBeenCalledOnce();
    const [, request] = mockClient.recall.mock.calls[0];
    expect(request.query).toBe('a longer prompt query');
  });

  it('handles partial bank failure gracefully', async () => {
    const mem = makeMemory('b1', 'From surviving bank');
    mockClient.recall
      .mockRejectedValueOnce(new Error('Bank A is down'))
      .mockResolvedValueOnce({ results: [mem], entities: null, trace: null, chunks: null });

    const config: ResolvedConfig = {
      ...baseAgentConfig,
      _recallFrom: [{ bankId: 'bank-a' }, { bankId: 'bank-b' }],
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await handleRecall(
      { rawMessage: 'partial failure test' },
      baseCtx,
      config,
      mockClient,
      basePluginConfig,
    );
    warnSpy.mockRestore();

    expect(result).toContain('From surviving bank');
    expect(result).not.toContain('Bank A');
  });

  it('strips metadata from rawMessage before querying (C1)', async () => {
    mockClient.recall.mockResolvedValue({ results: [makeMemory('m1', 'result')], entities: null, trace: null, chunks: null });

    await handleRecall(
      { rawMessage: 'Sender (untrusted metadata):\n```json\n{"id":"u1"}\n```\nWhat is the weather?' },
      baseCtx,
      baseAgentConfig,
      mockClient,
      basePluginConfig,
    );

    const [, request] = mockClient.recall.mock.calls[0];
    expect(request.query).toBe('What is the weather?');
    expect(request.query).not.toContain('untrusted metadata');
  });

  it('uses multi-turn context when recallContextTurns > 1 (C1)', async () => {
    mockClient.recall.mockResolvedValue({ results: [makeMemory('m1', 'result')], entities: null, trace: null, chunks: null });

    const config: ResolvedConfig = {
      ...baseAgentConfig,
      recallContextTurns: 3,
    };

    const event = {
      rawMessage: 'what about that?',
      messages: [
        { role: 'user', content: 'tell me about dogs' },
        { role: 'assistant', content: 'Dogs are great pets.' },
        { role: 'user', content: 'what about that?' },
      ],
    };

    await handleRecall(event, baseCtx, config, mockClient, basePluginConfig);

    const [, request] = mockClient.recall.mock.calls[0];
    expect(request.query).toContain('Prior context:');
    expect(request.query).toContain('tell me about dogs');
    expect(request.query).toContain('what about that?');
  });
});

// ── handleRecall — memory mode gating ───────────────────────────────

describe('handleRecall — memory mode gating', () => {
  it('skips recall when topic mode is "disabled"', async () => {
    const client = makeClient();
    const topicIndex = new Map([['12345', { strategy: 'silent', mode: 'disabled' as const }]]);
    const agentConfig: ResolvedConfig = { ...baseAgentConfig, _topicIndex: topicIndex };
    const ctxWithTopic: PluginHookAgentContext = {
      ...baseCtx,
      sessionKey: 'agent:yoda:main:thread:276243527:12345',
    };
    const event = { rawMessage: 'Hello there friend' };

    const result = await handleRecall(event, ctxWithTopic, agentConfig, client as any, basePluginConfig);

    expect(result).toBeUndefined();
    expect(client.recall).not.toHaveBeenCalled();
  });

  it('proceeds with recall when topic mode is "recall"', async () => {
    const client = makeClient();
    client.recall.mockResolvedValue({ results: [makeMemory('m1', 'memory text')], entities: null, trace: null, chunks: null });
    const topicIndex = new Map([['12345', { strategy: 'readonly', mode: 'recall' as const }]]);
    const agentConfig: ResolvedConfig = { ...baseAgentConfig, _topicIndex: topicIndex };
    const ctxWithTopic: PluginHookAgentContext = {
      ...baseCtx,
      sessionKey: 'agent:yoda:main:thread:276243527:12345',
    };
    const event = { rawMessage: 'What do you remember?' };

    const result = await handleRecall(event, ctxWithTopic, agentConfig, client as any, basePluginConfig);

    expect(client.recall).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('proceeds with recall when topic mode is "full"', async () => {
    const client = makeClient();
    client.recall.mockResolvedValue({ results: [makeMemory('m1', 'memory text')], entities: null, trace: null, chunks: null });
    const topicIndex = new Map([['280304', { strategy: 'deep-analysis', mode: 'full' as const }]]);
    const agentConfig: ResolvedConfig = { ...baseAgentConfig, _topicIndex: topicIndex };
    const ctxWithTopic: PluginHookAgentContext = {
      ...baseCtx,
      sessionKey: 'agent:yoda:main:thread:276243527:280304',
    };
    const event = { rawMessage: 'Recall something please' };

    const result = await handleRecall(event, ctxWithTopic, agentConfig, client as any, basePluginConfig);

    expect(client.recall).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('skips recall when _defaultMode is "disabled" and no topic match', async () => {
    const client = makeClient();
    const agentConfig: ResolvedConfig = { ...baseAgentConfig, _defaultMode: 'disabled' as const };
    const event = { rawMessage: 'Hello there friend' };

    const result = await handleRecall(event, baseCtx, agentConfig, client as any, basePluginConfig);

    expect(result).toBeUndefined();
    expect(client.recall).not.toHaveBeenCalled();
  });

  it('proceeds when no memory section at all (backward compat)', async () => {
    const client = makeClient();
    client.recall.mockResolvedValue({ results: [makeMemory('m1', 'memory text')], entities: null, trace: null, chunks: null });
    const agentConfig: ResolvedConfig = { ...baseAgentConfig };
    const event = { rawMessage: 'Regular recall query' };

    const result = await handleRecall(event, baseCtx, agentConfig, client as any, basePluginConfig);

    expect(client.recall).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
