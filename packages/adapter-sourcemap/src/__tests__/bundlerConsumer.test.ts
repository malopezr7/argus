/**
 * Task 5.2 — Bundler emits a map that SourceMapConsumer can load and resolve (REQ-13-C, AC-01).
 *
 * This test lives in @arguslab/sourcemap (where source-map is confined per AC-14/REQ-19-C).
 * It imports EsbuildBundler from @arguslab/esbuild (workspace devDep) and verifies that
 * the emitted bundle.map resolves a known user-source position via SourceMapConsumer.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EsbuildBundler } from '@arguslab/esbuild';
import { SourceMapConsumer } from 'source-map';
import { describe, expect, it } from 'vitest';

// Resolve paths relative to repo root
// adapter-sourcemap/src/__tests__/ → adapter-sourcemap/src/ → adapter-sourcemap/ → packages/ → root
const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..'); // src -> adapter-sourcemap -> packages -> root
const FRAMEWORK_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'index');
const COMPONENT_PATH = resolve(REPO_ROOT, 'packages', 'rntl', 'src', 'index');
const POLYFILL_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'polyfill');

// Use the real math.test.ts fixture — it has a known statement at line 10
const FIXTURE_PATH = resolve(REPO_ROOT, 'examples', 'math.test.ts');
// `expect(1 + 1).toBe(2);` is on line 10 in math.test.ts
const KNOWN_LINE = 10;

describe('EsbuildBundler map → SourceMapConsumer position resolution (REQ-13-C)', () => {
  it('SourceMapConsumer resolves a known user-source position from bundle.map (AC-01)', async () => {
    const bundler = new EsbuildBundler();
    const bundle = await bundler.bundle({
      testPaths: [FIXTURE_PATH],
      frameworkPath: FRAMEWORK_PATH,
      componentPath: COMPONENT_PATH,
      polyfillPaths: [POLYFILL_PATH],
      engineTarget: ['es2020'],
    });

    expect(typeof bundle.map).toBe('string');

    const consumer = await new SourceMapConsumer(bundle.map as string);
    try {
      // Find a mapping that targets our fixture file at the known line
      let found = false;
      consumer.eachMapping((mapping) => {
        if (mapping.source.includes('math.test.ts') && mapping.originalLine === KNOWN_LINE) {
          // Reverse-lookup from the generated position
          const orig = consumer.originalPositionFor({
            line: mapping.generatedLine,
            column: mapping.generatedColumn,
          });
          expect(orig.source).toContain('math.test.ts');
          expect(orig.line).toBe(KNOWN_LINE);
          found = true;
        }
      });
      expect(found).toBe(true);
    } finally {
      consumer.destroy();
    }
  });
});
