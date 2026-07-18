import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildBundler } from '../index.js';

const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FRAMEWORK_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'index');
const COMPONENT_PATH = resolve(REPO_ROOT, 'packages', 'rntl', 'src', 'index');
const POLYFILL_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'polyfill');
const FIXTURES = resolve(REPO_ROOT, 'packages', 'adapter-esbuild', 'src', '__tests__', 'fixtures');

function bundleFixture(name: string) {
  return new EsbuildBundler().bundle({
    testPaths: [resolve(FIXTURES, name)],
    frameworkPath: FRAMEWORK_PATH,
    componentPath: COMPONENT_PATH,
    polyfillPaths: [POLYFILL_PATH],
    engineTarget: ['es2020'],
  });
}

function bundleAliasFixture() {
  return new EsbuildBundler().bundle({
    testPaths: [resolve(FIXTURES, 'argus-alias-fixture.ts')],
    frameworkPath: resolve(FIXTURES, 'framework', 'index'),
    componentPath: COMPONENT_PATH,
    polyfillPaths: [],
    engineTarget: ['es2020'],
  });
}

describe('EsbuildBundler component support', () => {
  it('compiles automatic development JSX and keeps the react-native alias', async () => {
    const bundle = await bundleFixture('component-jsx-fixture.tsx');

    expect(bundle.code).toContain('argus-dev-enabled');
    expect(bundle.code).toContain('react.development.js');
    expect(bundle.code).toContain('Text');
    expect(bundle.code).not.toContain('react-native/Libraries');
  });

  it('resolves the argus specifier to the isolated component facade', async () => {
    const bundle = await bundleAliasFixture();

    expect(bundle.code).toContain('argus-alias-resolved');
  });

  it('captures CommonJS re-export keys by function parameter for Hermes', async () => {
    const bundle = await bundleFixture('component-jsx-fixture.tsx');

    expect(bundle.code).toContain('capturedKey');
    expect(bundle.code).not.toContain('get: () => from[key]');
  });
});
