import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildBundler } from '../index.js';

const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FRAMEWORK_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'index');
const COMPONENT_PATH = resolve(REPO_ROOT, 'packages', 'rntl', 'src', 'index');
const POLYFILL_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'polyfill');
const FIXTURE_PATH = resolve(
  REPO_ROOT,
  'packages',
  'adapter-esbuild',
  'src',
  '__tests__',
  'fixtures',
  'rn-alias-fixture.ts',
);

describe('EsbuildBundler react-native alias', () => {
  it('resolves the bare react-native specifier to the Argus shim', async () => {
    const bundler = new EsbuildBundler();

    const bundle = await bundler.bundle({
      testPaths: [FIXTURE_PATH],
      frameworkPath: FRAMEWORK_PATH,
      componentPath: COMPONENT_PATH,
      polyfillPaths: [POLYFILL_PATH],
      engineTarget: ['es2020'],
    });

    expect(bundle.code).toContain('TurboModuleRegistry');
    expect(bundle.code).toContain('getEnforcing');
    expect(bundle.code).not.toContain('react-native/Libraries');
  });
});
