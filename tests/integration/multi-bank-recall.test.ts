import { describe, it, expect, beforeAll } from 'vitest';
import { HindsightClient } from '../../src/client.js';

const API_URL = process.env.HINDSIGHT_API_URL || 'http://localhost:8888';
const API_TOKEN = process.env.HINDSIGHT_API_TOKEN;

describe('Multi-Bank Recall Integration', () => {
  let client: HindsightClient;
  const BANK_A = `test-multi-a-${Date.now()}`;
  const BANK_B = `test-multi-b-${Date.now()}`;

  beforeAll(async () => {
    client = new HindsightClient({ apiUrl: API_URL, apiToken: API_TOKEN });

    // Seed banks with different content
    await client.retain(BANK_A, {
      items: [{ content: 'Alice works at Google as a software engineer' }],
    });
    await client.retain(BANK_B, {
      items: [{ content: 'Bob works at Microsoft as a product manager' }],
    });

    // Wait for async processing
    await new Promise(r => setTimeout(r, 5000));
  });

  it('recalls from bank A', async () => {
    const result = await client.recall(BANK_A, { query: 'Who works at Google?', budget: 'low' });
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('recalls from bank B', async () => {
    const result = await client.recall(BANK_B, { query: 'Who works at Microsoft?', budget: 'low' });
    expect(result.results.length).toBeGreaterThan(0);
  });
});
