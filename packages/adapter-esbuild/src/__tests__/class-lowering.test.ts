import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasClassSyntax } from '../hermes-class-lowering.js';
import { EsbuildBundler } from '../index.js';

const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FRAMEWORK_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'index');
const POLYFILL_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'polyfill');
const FIXTURE_PATH = resolve(
  REPO_ROOT,
  'packages',
  'adapter-esbuild',
  'src',
  '__tests__',
  'fixtures',
  'class-lowering-entry.ts',
);
const CLASS_FORM_FIXTURES = [
  'class-heritage-entry.ts',
  'anonymous-heritage-class-entry.ts',
  'new-anonymous-class-entry.ts',
] as const;

async function bundleFixture(name: string) {
  return new EsbuildBundler().bundle({
    testPaths: [
      resolve(REPO_ROOT, 'packages', 'adapter-esbuild', 'src', '__tests__', 'fixtures', name),
    ],
    frameworkPath: FRAMEWORK_PATH,
    polyfillPaths: [POLYFILL_PATH],
    engineTarget: ['es2020'],
  });
}

describe('Hermes dependency class lowering', () => {
  it('does not select class words inside strings', () => {
    expect(hasClassSyntax('const warning = "define a class property";')).toBe(false);
    expect(hasClassSyntax('var Example = class Example { method() {} };')).toBe(true);
  });

  it('removes class syntax from JavaScript dependencies in node_modules', async () => {
    const bundle = await new EsbuildBundler().bundle({
      testPaths: [FIXTURE_PATH],
      frameworkPath: FRAMEWORK_PATH,
      polyfillPaths: [POLYFILL_PATH],
      engineTarget: ['es2020'],
    });

    expect(bundle.code).toContain('value-box');
    expect(bundle.code).toContain('doubled');
    expect(bundle.code).not.toMatch(/(?:^|[=;{}])\s*class\b|\bexport\s+class\b/m);
  });

  it.each(CLASS_FORM_FIXTURES)('lowers every dependency class form in %s', async (fixture) => {
    const bundle = await bundleFixture(fixture);

    expect(bundle.code).not.toMatch(/\bclass(?:\s+[$\w]+)?(?:\s+extends\s+[$\w.]+)?\s*\{/m);
  });
});
