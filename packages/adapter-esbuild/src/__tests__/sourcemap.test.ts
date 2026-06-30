/**
 * Task 5.2 — Bundler emits a usable V3 source map (AC-01, REQ-13-A, REQ-13-B/AC-20).
 *
 * Verifies:
 * - bundle.map is a string
 * - JSON.parse(bundle.map).version === 3
 * - mappings is non-empty
 * - sources contains the user test file (REQ-13-A)
 * - bundle.code does NOT contain a sourceMappingURL comment (REQ-13-B, AC-20)
 *
 * NOTE: The SourceMapConsumer position-resolution test (REQ-13-C) lives in
 * packages/adapter-sourcemap where source-map is confined (AC-14/REQ-19-C).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildBundler } from '../index.js';

// Paths resolved relative to repo root (adapter-esbuild is packages/adapter-esbuild)
const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..'); // src -> adapter-esbuild -> packages -> root
const FRAMEWORK_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'index');
const POLYFILL_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'polyfill');
const FIXTURE_PATH = resolve(REPO_ROOT, 'examples', 'math.test.ts');

describe('EsbuildBundler source-map generation (ADR-1)', () => {
  it('bundle.map is a valid V3 source-map JSON string containing the user test file (REQ-13-A, AC-01)', async () => {
    const bundler = new EsbuildBundler();
    const bundle = await bundler.bundle({
      testPaths: [FIXTURE_PATH],
      frameworkPath: FRAMEWORK_PATH,
      polyfillPaths: [POLYFILL_PATH],
      engineTarget: ['es2020'],
    });

    expect(typeof bundle.map).toBe('string');
    const parsed = JSON.parse(bundle.map as string) as {
      version: number;
      mappings: string;
      sources: string[];
    };
    expect(parsed.version).toBe(3);
    expect(typeof parsed.mappings).toBe('string');
    expect(parsed.mappings.length).toBeGreaterThan(0);
    expect(parsed.sources).toBeInstanceOf(Array);
    // The map must reference the user test file
    expect(parsed.sources.some((s: string) => s.includes('math.test.ts'))).toBe(true);
  });

  it('bundle.code does NOT contain a sourceMappingURL comment (REQ-13-B, AC-20)', async () => {
    const bundler = new EsbuildBundler();
    const bundle = await bundler.bundle({
      testPaths: [FIXTURE_PATH],
      frameworkPath: FRAMEWORK_PATH,
      polyfillPaths: [POLYFILL_PATH],
      engineTarget: ['es2020'],
    });

    expect(bundle.code).not.toContain('sourceMappingURL');
  });

  it('bundle.sizeBytes matches code byte length; map is separate and non-empty', async () => {
    const bundler = new EsbuildBundler();
    const bundle = await bundler.bundle({
      testPaths: [FIXTURE_PATH],
      frameworkPath: FRAMEWORK_PATH,
      polyfillPaths: [POLYFILL_PATH],
      engineTarget: ['es2020'],
    });

    const { Buffer } = await import('node:buffer');
    expect(bundle.sizeBytes).toBe(Buffer.byteLength(bundle.code, 'utf8'));
    expect(bundle.map?.length ?? 0).toBeGreaterThan(0);
  });
});
