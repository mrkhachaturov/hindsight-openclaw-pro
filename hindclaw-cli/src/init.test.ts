import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit } from './init.js';

const TEST_DIR = join(tmpdir(), `hindclaw-init-test-${Date.now()}`);
const OPENCLAW_DIR = join(TEST_DIR, '.openclaw');
const HINDSIGHT_DIR = join(OPENCLAW_DIR, 'hindsight');

function writeJson5(path: string, data: any) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

beforeEach(() => {
  mkdirSync(OPENCLAW_DIR, { recursive: true });

  // Minimal openclaw.json with plugin config
  writeJson5(join(OPENCLAW_DIR, 'openclaw.json'), {
    plugins: {
      entries: {
        'hindclaw': {
          enabled: true,
          config: {
            dynamicBankGranularity: ['agent'],
            llmProvider: 'claude-code',
            bootstrap: true,
            debug: true,
            embedPackagePath: '/path/to/embed',
            agents: {
              yoda: { bankConfig: './banks/yoda.json5' },
              r2d2: { bankConfig: './banks/r2d2.json5' },
            },
          },
        },
      },
    },
  });

  // Existing bank configs
  mkdirSync(join(OPENCLAW_DIR, 'banks'), { recursive: true });
  writeJson5(join(OPENCLAW_DIR, 'banks', 'yoda.json5'), {
    bank_id: 'yoda',
    retain_mission: 'Extract strategic decisions.',
    memory: {
      default: 'full',
      full: { 'deep-analysis': { topics: ['280304'] } },
    },
  });
  writeJson5(join(OPENCLAW_DIR, 'banks', 'r2d2.json5'), {
    bank_id: 'r2d2',
    retain_mission: 'Extract infrastructure data.',
  });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('hindclaw init --from-existing', () => {
  it('creates hindsight directory structure', async () => {
    await runInit({ configPath: join(OPENCLAW_DIR, 'openclaw.json'), fromExisting: true });
    expect(existsSync(join(HINDSIGHT_DIR, 'config.json5'))).toBe(true);
    expect(existsSync(join(HINDSIGHT_DIR, 'banks'))).toBe(true);
    expect(existsSync(join(HINDSIGHT_DIR, 'groups'))).toBe(true);
    expect(existsSync(join(HINDSIGHT_DIR, 'users'))).toBe(true);
  });

  it('generates config.json5 from inline plugin config', async () => {
    await runInit({ configPath: join(OPENCLAW_DIR, 'openclaw.json'), fromExisting: true });
    const config = JSON.parse(readFileSync(join(HINDSIGHT_DIR, 'config.json5'), 'utf-8'));
    expect(config.dynamicBankGranularity).toEqual(['agent']);
    expect(config.llmProvider).toBe('claude-code');
    expect(config.bootstrap).toBe(true);
    expect(config.embedPackagePath).toBe('/path/to/embed');
    // agents mapping should NOT be in config.json5
    expect(config.agents).toBeUndefined();
  });

  it('copies bank configs to hindsight/banks/', async () => {
    await runInit({ configPath: join(OPENCLAW_DIR, 'openclaw.json'), fromExisting: true });
    expect(existsSync(join(HINDSIGHT_DIR, 'banks', 'yoda.json5'))).toBe(true);
    expect(existsSync(join(HINDSIGHT_DIR, 'banks', 'r2d2.json5'))).toBe(true);
  });

  it('converts memory → retain.strategies in bank configs', async () => {
    await runInit({ configPath: join(OPENCLAW_DIR, 'openclaw.json'), fromExisting: true });
    const yoda = JSON.parse(readFileSync(join(HINDSIGHT_DIR, 'banks', 'yoda.json5'), 'utf-8'));
    expect(yoda.retain?.strategies?.['deep-analysis']?.topics).toEqual(['280304']);
    expect(yoda.memory).toBeUndefined();
  });

  it('generates _default group', async () => {
    await runInit({ configPath: join(OPENCLAW_DIR, 'openclaw.json'), fromExisting: true });
    const defaultGroup = JSON.parse(
      readFileSync(join(HINDSIGHT_DIR, 'groups', '_default.json5'), 'utf-8')
    );
    expect(defaultGroup.displayName).toBe('Anonymous');
    expect(defaultGroup.recall).toBe(true);   // safe default: current behavior
    expect(defaultGroup.retain).toBe(true);
    expect(defaultGroup.members).toEqual([]);
  });

  it('generates template files', async () => {
    await runInit({ configPath: join(OPENCLAW_DIR, 'openclaw.json'), fromExisting: true });
    expect(existsSync(join(HINDSIGHT_DIR, 'banks', '_template.json5'))).toBe(true);
    expect(existsSync(join(HINDSIGHT_DIR, 'groups', '_template.json5'))).toBe(true);
    expect(existsSync(join(HINDSIGHT_DIR, 'users', '_template.json5'))).toBe(true);
  });

  it('only migrates full-mode strategies, drops recall/disabled with warning', async () => {
    // Replace yoda bank with multi-mode memory config
    writeJson5(join(OPENCLAW_DIR, 'banks', 'yoda.json5'), {
      bank_id: 'yoda',
      retain_mission: 'test',
      memory: {
        default: 'full',
        full: { 'deep-analysis': { topics: ['280304'] } },
        recall: { 'review': { topics: ['280475'] } },
        disabled: { 'silent': { topics: ['280500'] } },
      },
    });
    const consoleSpy = vi.spyOn(console, 'warn');
    await runInit({ configPath: join(OPENCLAW_DIR, 'openclaw.json'), fromExisting: true });

    const yoda = JSON.parse(readFileSync(join(HINDSIGHT_DIR, 'banks', 'yoda.json5'), 'utf-8'));
    // Only full strategies migrated
    expect(yoda.retain?.strategies?.['deep-analysis']?.topics).toEqual(['280304']);
    // recall/disabled strategies NOT migrated
    expect(yoda.retain?.strategies?.['review']).toBeUndefined();
    expect(yoda.retain?.strategies?.['silent']).toBeUndefined();
    // Warnings emitted for dropped strategies
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('recall'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'));
    consoleSpy.mockRestore();
  });

  it('does not overwrite existing hindsight directory', async () => {
    mkdirSync(HINDSIGHT_DIR, { recursive: true });
    writeFileSync(join(HINDSIGHT_DIR, 'config.json5'), '{"existing": true}');
    await expect(
      runInit({ configPath: join(OPENCLAW_DIR, 'openclaw.json'), fromExisting: true })
    ).rejects.toThrow('already exists');
  });

  it('overwrites with --force flag', async () => {
    mkdirSync(HINDSIGHT_DIR, { recursive: true });
    writeFileSync(join(HINDSIGHT_DIR, 'config.json5'), '{"existing": true}');
    await runInit({
      configPath: join(OPENCLAW_DIR, 'openclaw.json'),
      fromExisting: true,
      force: true,
    });
    const config = JSON.parse(readFileSync(join(HINDSIGHT_DIR, 'config.json5'), 'utf-8'));
    expect(config.existing).toBeUndefined();
    expect(config.llmProvider).toBe('claude-code');
  });
});

describe('hindclaw init (fresh)', () => {
  it('creates empty structure with defaults', async () => {
    await runInit({ configPath: join(OPENCLAW_DIR, 'openclaw.json'), fromExisting: false });
    expect(existsSync(join(HINDSIGHT_DIR, 'config.json5'))).toBe(true);
    expect(existsSync(join(HINDSIGHT_DIR, 'groups', '_default.json5'))).toBe(true);
    // No bank configs copied (fresh init)
    expect(existsSync(join(HINDSIGHT_DIR, 'banks', 'yoda.json5'))).toBe(false);
  });
});
