import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HermesEngine } from '@arguslab/core';
import { describe, expect, it } from 'vitest';
import { hasClassSyntax } from '../hermes-class-lowering.js';
import { EsbuildBundler } from '../index.js';

const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FRAMEWORK_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'index');
const COMPONENT_PATH = resolve(REPO_ROOT, 'packages', 'rntl', 'src', 'index');
const POLYFILL_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'polyfill');
const FIXTURES = resolve(REPO_ROOT, 'packages', 'adapter-esbuild', 'src', '__tests__', 'fixtures');
const FIXTURE_PATH = resolve(FIXTURES, 'class-lowering-entry.ts');

const CLASS_FORM_FIXTURES = [
  'class-heritage-entry.ts',
  'anonymous-heritage-class-entry.ts',
  'new-anonymous-class-entry.ts',
] as const;

/**
 * Real `class` syntax, as opposed to the word appearing inside a string — the
 * Babel runtime helpers embed "Cannot call a class as a function", so a bare
 * /\bclass\b/ would report a false positive on correctly lowered output.
 */
const CLASS_SYNTAX = /\bclass(?:\s+[$\w]+)?(?:\s+extends\s+[$\w.]+)?\s*\{/m;

/** Babel's class-lowering runtime helper — present only when Babel ran. */
const BABEL_CLASS_HELPER = /_classCallCheck/;

async function bundleFixture(name: string, engine: HermesEngine) {
  return new EsbuildBundler().bundle({
    testPaths: [resolve(FIXTURES, name)],
    frameworkPath: FRAMEWORK_PATH,
    componentPath: COMPONENT_PATH,
    polyfillPaths: [POLYFILL_PATH],
    engine,
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
      componentPath: COMPONENT_PATH,
      polyfillPaths: [POLYFILL_PATH],
      engine: 'legacy',
    });

    expect(bundle.code).toContain('value-box');
    expect(bundle.code).toContain('doubled');
    expect(bundle.code).not.toMatch(/(?:^|[=;{}])\s*class\b|\bexport\s+class\b/m);
  });

  it.each(CLASS_FORM_FIXTURES)('lowers every dependency class form in %s', async (fixture) => {
    const bundle = await bundleFixture(fixture, 'legacy');

    expect(bundle.code).not.toMatch(CLASS_SYNTAX);
  });
});

/**
 * The user's OWN test file is the case that matters most: a class there is
 * ordinary React Native code, and before the engine target was derived from the
 * resolved engine it reached legacy Hermes verbatim and killed the whole file
 * with "Invalid expression encountered".
 */
describe('legacy engine — user source is lowered too', () => {
  it("lowers a class written in the user's own .ts file", async () => {
    const bundle = await bundleFixture('user-class-entry.ts', 'legacy');

    // The code is still there — lowering must preserve behaviour, not drop it.
    expect(bundle.code).toContain('dob');
    expect(bundle.code).not.toMatch(CLASS_SYNTAX);
  });

  it("lowers a class written in the user's own .tsx file, keeping the JSX", async () => {
    const bundle = await bundleFixture('user-class-jsx-entry.tsx', 'legacy');

    expect(bundle.code).not.toMatch(CLASS_SYNTAX);
    // The JSX transform must still have run — a lowering path that stripped
    // TypeScript but skipped JSX would leave `<Text>` for Hermes to choke on.
    expect(bundle.code).not.toContain('<Text>');
    expect(bundle.code).toContain('jsxDEV');
  });

  it('lowers extends, private fields and static blocks from user source', async () => {
    const bundle = await bundleFixture('modern-class-entry.ts', 'legacy');

    expect(bundle.code).not.toMatch(CLASS_SYNTAX);
    expect(bundle.code).not.toContain('#secret');
    expect(bundle.code).not.toMatch(/\bstatic\s*\{/);
  });
});

/**
 * V1 parses every one of these natively. Lowering them anyway would run the
 * user's tests against code they did not write, which is precisely the fidelity
 * Argus exists to protect.
 */
describe('v1 engine — nothing is downlevelled needlessly', () => {
  it("keeps a class from the user's own .ts file verbatim", async () => {
    const bundle = await bundleFixture('user-class-entry.ts', 'v1');

    expect(bundle.code).toMatch(CLASS_SYNTAX);
    expect(bundle.code).not.toMatch(BABEL_CLASS_HELPER);
  });

  it('keeps extends, private fields and static blocks', async () => {
    const bundle = await bundleFixture('modern-class-entry.ts', 'v1');

    // esbuild emits the declaration as a named class EXPRESSION
    // (`var Derived = class _Derived extends Base {`), which is still native
    // class syntax — the point is that `extends` survived rather than becoming
    // a Babel prototype chain.
    expect(bundle.code).toMatch(/\bclass\s+[$\w]*\s*extends\s+Base\s*\{/);
    expect(bundle.code).toContain('#secret');
    expect(bundle.code).toMatch(/\bstatic\s*\{/);
    expect(bundle.code).not.toMatch(BABEL_CLASS_HELPER);
  });

  it('leaves dependency classes in node_modules alone', async () => {
    const bundle = await bundleFixture('class-lowering-entry.ts', 'v1');

    expect(bundle.code).toMatch(CLASS_SYNTAX);
    expect(bundle.code).not.toMatch(BABEL_CLASS_HELPER);
  });
});
