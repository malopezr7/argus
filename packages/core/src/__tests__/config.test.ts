import { describe, expect, it } from 'vitest';
import type { ArgusConfig } from '../index.js';
import {
  DEFAULT_CONCURRENCY_CAP,
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  DEFAULT_TIMEOUT_MS,
  defineConfig,
} from '../index.js';

describe('defineConfig', () => {
  it('returns the same object it was given', () => {
    const config: ArgusConfig = { timeout: 5_000 };

    expect(defineConfig(config)).toBe(config);
  });
});

describe('config defaults', () => {
  it('includes .test.ts and .test.tsx', () => {
    expect(DEFAULT_INCLUDE).toEqual(['**/*.test.ts', '**/*.test.tsx']);
  });

  it('excludes node_modules, build output, coverage and git metadata', () => {
    expect(DEFAULT_EXCLUDE).toEqual([
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.git/**',
    ]);
  });

  it('times a file out after ten seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });

  it('caps concurrency at eight', () => {
    expect(DEFAULT_CONCURRENCY_CAP).toBe(8);
  });
});
