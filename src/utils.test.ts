import { describe, it, expect } from 'vitest';
import { extractTopicId } from './utils.js';

describe('extractTopicId', () => {
  it('extracts topic ID from DM session key', () => {
    expect(extractTopicId('agent:yoda:main:thread:276243527:280304')).toBe('280304');
  });

  it('extracts topic ID from group forum session key', () => {
    expect(extractTopicId('agent:yoda:telegram:group:-100xxx:topic:42')).toBe('42');
  });

  it('returns undefined for session key without topic', () => {
    expect(extractTopicId('agent:yoda:main:thread:276243527')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(extractTopicId(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractTopicId('')).toBeUndefined();
  });

  it('returns undefined for plain session key', () => {
    expect(extractTopicId('test-session')).toBeUndefined();
  });
});
