import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRecallFilter, interleaveResults, handleRecall } from './recall.js';
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

    // Interleaved order: a1, b1, a2
    expect(result).toBeDefined();
    const lines = result!.split('\n\n').filter(l => l.startsWith('- '));
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
});
