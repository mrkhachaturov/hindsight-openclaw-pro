import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stripMemoryTags } from '../utils.js';
import { prepareRetentionTranscript, handleRetain } from './retain.js';
import type { HindsightClient } from '../client.js';
import type { ResolvedConfig, PluginConfig, PluginHookAgentContext } from '../types.js';

// ── stripMemoryTags ───────────────────────────────────────────────────

describe('stripMemoryTags', () => {
  it('removes hindsight_memories blocks', () => {
    const input = 'Hello <hindsight_memories>secret memories here</hindsight_memories> world';
    expect(stripMemoryTags(input)).toBe('Hello  world');
  });

  it('removes relevant_memories blocks (C4)', () => {
    const input = 'Before <relevant_memories>some memories</relevant_memories> after';
    expect(stripMemoryTags(input)).toBe('Before  after');
  });

  it('removes hindsight_context blocks', () => {
    const input = 'Before <hindsight_context>some context</hindsight_context> after';
    expect(stripMemoryTags(input)).toBe('Before  after');
  });

  it('removes all three tag types when present', () => {
    const input = '<hindsight_memories>mem</hindsight_memories> text <hindsight_context>ctx</hindsight_context> more <relevant_memories>rel</relevant_memories>';
    expect(stripMemoryTags(input)).toBe(' text  more ');
  });

  it('handles multiline blocks', () => {
    const input = 'Start\n<hindsight_memories>\nline1\nline2\n</hindsight_memories>\nEnd';
    expect(stripMemoryTags(input)).toBe('Start\n\nEnd');
  });

  it('returns unchanged text when no tags present', () => {
    expect(stripMemoryTags('plain text')).toBe('plain text');
  });
});

// ── prepareRetentionTranscript ────────────────────────────────────────

describe('prepareRetentionTranscript', () => {
  const messages = [
    { role: 'user', content: 'Hello agent' },
    { role: 'assistant', content: 'Hi there' },
    { role: 'system', content: 'System prompt' },
    { role: 'tool', content: 'Tool result' },
  ];

  it('returns native format [role: X]\\ncontent\\n[X:end]', () => {
    const result = prepareRetentionTranscript(messages, ['user', 'assistant']);
    expect(result).not.toBeNull();
    expect(result!.transcript).toContain('[role: user]\nHello agent\n[user:end]');
    expect(result!.transcript).toContain('[role: assistant]\nHi there\n[assistant:end]');
    expect(result!.messageCount).toBe(2);
  });

  it('retains only from last user message by default', () => {
    const msgs = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Second answer' },
    ];
    const result = prepareRetentionTranscript(msgs, ['user', 'assistant']);
    expect(result).not.toBeNull();
    expect(result!.transcript).not.toContain('First question');
    expect(result!.transcript).toContain('Second question');
    expect(result!.transcript).toContain('Second answer');
  });

  it('retains full window when retainFullWindow is true', () => {
    const msgs = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Second answer' },
    ];
    const result = prepareRetentionTranscript(msgs, ['user', 'assistant'], true);
    expect(result).not.toBeNull();
    expect(result!.transcript).toContain('First question');
    expect(result!.transcript).toContain('Second answer');
    expect(result!.messageCount).toBe(4);
  });

  it('includes system and tool roles when specified', () => {
    const result = prepareRetentionTranscript(messages, ['user', 'assistant', 'system', 'tool']);
    expect(result).not.toBeNull();
    expect(result!.transcript).toContain('[role: system]\nSystem prompt\n[system:end]');
    expect(result!.transcript).toContain('[role: tool]\nTool result\n[tool:end]');
  });

  it('strips hindsight_memories tags from content', () => {
    const msgs = [
      { role: 'user', content: 'Question <hindsight_memories>leaked</hindsight_memories>' },
      { role: 'assistant', content: 'Answer' },
    ];
    const result = prepareRetentionTranscript(msgs, ['user', 'assistant']);
    expect(result).not.toBeNull();
    expect(result!.transcript).not.toContain('<hindsight_memories>');
    expect(result!.transcript).toContain('Question');
  });

  it('strips metadata envelopes from content', () => {
    const msgs = [
      { role: 'user', content: 'Sender (untrusted metadata):\n```json\n{"id":"u1"}\n```\nActual message' },
      { role: 'assistant', content: 'Response' },
    ];
    const result = prepareRetentionTranscript(msgs, ['user', 'assistant']);
    expect(result).not.toBeNull();
    expect(result!.transcript).not.toContain('untrusted metadata');
    expect(result!.transcript).toContain('Actual message');
  });

  it('skips messages with empty content after stripping', () => {
    const msgs = [
      { role: 'user', content: '<hindsight_memories>only tags</hindsight_memories>' },
      { role: 'assistant', content: 'Response' },
    ];
    // With last-user-idx logic, user message is the start, but it becomes empty.
    // The transcript should only contain the assistant response.
    const result = prepareRetentionTranscript(msgs, ['user', 'assistant']);
    expect(result).not.toBeNull();
    expect(result!.transcript).toContain('[role: assistant]');
    expect(result!.messageCount).toBe(1);
  });

  it('returns null when no user message found (non-fullWindow)', () => {
    const msgs = [
      { role: 'system', content: 'System only' },
      { role: 'assistant', content: 'Response' },
    ];
    const result = prepareRetentionTranscript(msgs, ['user', 'assistant']);
    expect(result).toBeNull();
  });

  it('returns null when transcript is too short (< 10 chars)', () => {
    const msgs = [
      { role: 'user', content: 'Hi' },
    ];
    // After wrapping: [role: user]\nHi\n[user:end] = 24 chars, so this should pass
    const result = prepareRetentionTranscript(msgs, ['user']);
    expect(result).not.toBeNull();

    // But very short content after stripping...
    const msgs2 = [
      { role: 'user', content: '<hindsight_memories>lots of stuff</hindsight_memories>ab' },
    ];
    // "ab" is too short for the trim check (content) but [role: user]\nab\n[user:end] = 22 chars >= 10
    const result2 = prepareRetentionTranscript(msgs2, ['user']);
    expect(result2).not.toBeNull();
  });

  it('handles Array<{type:"text", text:string}> content format', () => {
    const msgs = [
      { role: 'user', content: [{ type: 'text', text: 'Hello from array' }] },
      { role: 'assistant', content: 'Reply' },
    ];
    const result = prepareRetentionTranscript(msgs, ['user', 'assistant']);
    expect(result).not.toBeNull();
    expect(result!.transcript).toContain('Hello from array');
  });
});

// ── handleRetain ──────────────────────────────────────────────────────

describe('handleRetain', () => {
  let mockRetain: ReturnType<typeof vi.fn>;
  let client: HindsightClient;
  let pluginConfig: PluginConfig;
  let ctx: PluginHookAgentContext;

  beforeEach(() => {
    mockRetain = vi.fn().mockResolvedValue({ message: 'ok', document_id: 'doc1', memory_unit_ids: [] });
    client = { retain: mockRetain } as unknown as HindsightClient;
    pluginConfig = {};
    ctx = {
      agentId: 'r2d2',
      sessionKey: 'test-session',
      messageProvider: 'telegram',
      channelId: 'chan-1',
      senderId: 'user-42',
    };
  });

  const makeEvent = (messages: Array<{ role: string; content: string }>) => ({ messages });

  it('calls client.retain with items[] format and native transcript format', async () => {
    const event = makeEvent([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'World' },
    ]);
    const agentConfig: ResolvedConfig = {};

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    expect(mockRetain).toHaveBeenCalledOnce();
    const [bankId, request] = mockRetain.mock.calls[0];
    expect(typeof bankId).toBe('string');
    expect(request.items).toHaveLength(1);
    expect(request.items[0].content).toContain('[role: user]\nHello\n[user:end]');
    expect(request.items[0].content).toContain('[role: assistant]\nWorld\n[assistant:end]');
    expect(request.async).toBe(true);
  });

  it('includes tags, context, and observation_scopes from agentConfig', async () => {
    const event = makeEvent([{ role: 'user', content: 'Hi there friend' }]);
    const agentConfig: ResolvedConfig = {
      retainTags: ['health', 'daily'],
      retainContext: { project: 'astromech', env: 'prod' },
      retainObservationScopes: ['fitness', 'sleep'],
    };

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    const [, request] = mockRetain.mock.calls[0];
    expect(request.items[0].tags).toEqual(['health', 'daily']);
    expect(request.items[0].context).toEqual({ project: 'astromech', env: 'prod' });
    expect(request.items[0].observation_scopes).toEqual(['fitness', 'sleep']);
  });

  it('includes metadata with retained_at, message_count, channel_type, channel_id, sender_id', async () => {
    const event = makeEvent([{ role: 'user', content: 'Test message here' }]);
    const agentConfig: ResolvedConfig = {};

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    const [, request] = mockRetain.mock.calls[0];
    const meta = request.items[0].metadata as Record<string, string>;
    expect(meta.retained_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.message_count).toBe('1');
    expect(meta.channel_type).toBe('telegram');
    expect(meta.channel_id).toBe('chan-1');
    expect(meta.sender_id).toBe('user-42');
  });

  it('includes document_id with session key prefix', async () => {
    const event = makeEvent([{ role: 'user', content: 'Test message here' }]);
    const agentConfig: ResolvedConfig = {};

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    const [, request] = mockRetain.mock.calls[0];
    expect(request.items[0].document_id).toMatch(/^session-test-session-\d+$/);
  });

  it('skips when autoRetain is false', async () => {
    const event = makeEvent([{ role: 'user', content: 'Hello' }]);
    const agentConfig: ResolvedConfig = { autoRetain: false };

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    expect(mockRetain).not.toHaveBeenCalled();
  });

  it('skips when no messages', async () => {
    const event = { messages: [] };
    const agentConfig: ResolvedConfig = {};

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    expect(mockRetain).not.toHaveBeenCalled();
  });

  it('skips when messages is undefined', async () => {
    const event = {};
    const agentConfig: ResolvedConfig = {};

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    expect(mockRetain).not.toHaveBeenCalled();
  });

  it('skips when no user message found after role filtering', async () => {
    const event = makeEvent([
      { role: 'system', content: 'System only' },
    ]);
    const agentConfig: ResolvedConfig = { retainRoles: ['user', 'assistant'] };

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    expect(mockRetain).not.toHaveBeenCalled();
  });

  it('reads messages from event.context.sessionEntry.messages when available', async () => {
    const event = {
      context: {
        sessionEntry: {
          messages: [{ role: 'user', content: 'From session entry' }],
        },
      },
    };
    const agentConfig: ResolvedConfig = {};

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    expect(mockRetain).toHaveBeenCalledOnce();
    const [, request] = mockRetain.mock.calls[0];
    expect(request.items[0].content).toContain('From session entry');
  });

  it('skips retain when topic mode is "disabled"', async () => {
    const event = makeEvent([{ role: 'user', content: 'Hello there friend' }]);
    const topicIndex = new Map([['12345', { strategy: 'silent', mode: 'disabled' as const }]]);
    const agentConfig: ResolvedConfig = { _topicIndex: topicIndex };
    const ctxWithTopic: PluginHookAgentContext = {
      ...ctx,
      sessionKey: 'agent:yoda:main:thread:276243527:12345',
    };

    await handleRetain(event, ctxWithTopic, agentConfig, client, pluginConfig);

    expect(mockRetain).not.toHaveBeenCalled();
  });

  it('skips retain when topic mode is "recall"', async () => {
    const event = makeEvent([{ role: 'user', content: 'Hello there friend' }]);
    const topicIndex = new Map([['12345', { strategy: 'readonly', mode: 'recall' as const }]]);
    const agentConfig: ResolvedConfig = { _topicIndex: topicIndex };
    const ctxWithTopic: PluginHookAgentContext = {
      ...ctx,
      sessionKey: 'agent:yoda:main:thread:276243527:12345',
    };

    await handleRetain(event, ctxWithTopic, agentConfig, client, pluginConfig);

    expect(mockRetain).not.toHaveBeenCalled();
  });

  it('retains with strategy name when topic mode is "full"', async () => {
    const event = makeEvent([{ role: 'user', content: 'Deep analysis topic' }]);
    const topicIndex = new Map([['280304', { strategy: 'deep-analysis', mode: 'full' as const }]]);
    const agentConfig: ResolvedConfig = { _topicIndex: topicIndex };
    const ctxWithTopic: PluginHookAgentContext = {
      ...ctx,
      sessionKey: 'agent:yoda:main:thread:276243527:280304',
    };

    await handleRetain(event, ctxWithTopic, agentConfig, client, pluginConfig);

    expect(mockRetain).toHaveBeenCalledOnce();
    const [, request] = mockRetain.mock.calls[0];
    expect(request.items[0].strategy).toBe('deep-analysis');
  });

  it('falls back to _defaultMode when topic not in index', async () => {
    const event = makeEvent([{ role: 'user', content: 'Unknown topic msg' }]);
    const topicIndex = new Map([['280304', { strategy: 'deep-analysis', mode: 'full' as const }]]);
    const agentConfig: ResolvedConfig = { _topicIndex: topicIndex, _defaultMode: 'full' as const };
    const ctxWithTopic: PluginHookAgentContext = {
      ...ctx,
      sessionKey: 'agent:yoda:main:thread:276243527:999999',
    };

    await handleRetain(event, ctxWithTopic, agentConfig, client, pluginConfig);

    expect(mockRetain).toHaveBeenCalledOnce();
    const [, request] = mockRetain.mock.calls[0];
    expect(request.items[0].strategy).toBeUndefined();
  });

  it('skips retain when _defaultMode is "disabled" and no topic match', async () => {
    const event = makeEvent([{ role: 'user', content: 'Hello there friend' }]);
    const agentConfig: ResolvedConfig = { _defaultMode: 'disabled' as const };

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    expect(mockRetain).not.toHaveBeenCalled();
  });

  it('proceeds with bank defaults when no memory section (backward compat)', async () => {
    const event = makeEvent([{ role: 'user', content: 'Regular message here' }]);
    const agentConfig: ResolvedConfig = {};

    await handleRetain(event, ctx, agentConfig, client, pluginConfig);

    expect(mockRetain).toHaveBeenCalledOnce();
    const [, request] = mockRetain.mock.calls[0];
    expect(request.items[0].strategy).toBeUndefined();
  });
});
