import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_FILE_NAMES, configBaseDir, locateConfig } from '../config/locate.js';

/** Builds an `exists` probe backed by a fixed set of absolute paths. */
function probe(...paths: string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

const ROOT = join('/', 'repo');
const NESTED = join(ROOT, 'packages', 'app');

describe('CONFIG_FILE_NAMES', () => {
  it('is searched in the documented order', () => {
    expect(CONFIG_FILE_NAMES).toEqual([
      'argus.config.ts',
      'argus.config.mts',
      'argus.config.js',
      'argus.config.mjs',
      join('.config', 'argus.config.ts'),
    ]);
  });
});

describe('locateConfig', () => {
  it('reports defaults when nothing is found anywhere', () => {
    expect(locateConfig(NESTED, probe())).toEqual({ kind: 'defaults' });
  });

  it('finds a config file in the starting directory', () => {
    const path = join(NESTED, 'argus.config.ts');

    expect(locateConfig(NESTED, probe(path))).toEqual({ kind: 'file', path });
  });

  /**
   * A repo root holding the config while `argus` is run from a subdirectory is
   * the ordinary case, so the search ascends.
   */
  it('ascends to a parent directory', () => {
    const path = join(ROOT, 'argus.config.ts');

    expect(locateConfig(NESTED, probe(path))).toEqual({ kind: 'file', path });
  });

  it.each([
    ['argus.config.mts'],
    ['argus.config.js'],
    ['argus.config.mjs'],
    [join('.config', 'argus.config.ts')],
  ])('accepts %s', (name) => {
    const path = join(NESTED, name);

    expect(locateConfig(NESTED, probe(path))).toEqual({ kind: 'file', path });
  });

  /**
   * Two config files in one directory is a mistake, not a merge. Taking the
   * first and ignoring the rest keeps "which file is in effect?" answerable by
   * reading one ordered list.
   */
  it('takes the first name in the list when several exist side by side', () => {
    const ts = join(NESTED, 'argus.config.ts');
    const js = join(NESTED, 'argus.config.js');

    expect(locateConfig(NESTED, probe(js, ts))).toEqual({ kind: 'file', path: ts });
  });

  it('prefers a nearer config file over one further up', () => {
    const near = join(NESTED, 'argus.config.js');
    const far = join(ROOT, 'argus.config.ts');

    expect(locateConfig(NESTED, probe(near, far))).toEqual({ kind: 'file', path: near });
  });

  it('falls back to package.json in the same directory', () => {
    const path = join(NESTED, 'package.json');

    expect(locateConfig(NESTED, probe(path))).toEqual({ kind: 'package-json', path });
  });

  it('prefers a config file over package.json in the same directory', () => {
    const config = join(NESTED, 'argus.config.ts');
    const pkg = join(NESTED, 'package.json');

    expect(locateConfig(NESTED, probe(config, pkg))).toEqual({ kind: 'file', path: config });
  });

  /**
   * package.json marks the project boundary. Ascending past it would let a
   * config file in an unrelated parent — a home directory, or another checkout
   * one level up — silently govern this project's test run.
   */
  it('stops at the first package.json and never looks above it', () => {
    const boundary = join(NESTED, 'package.json');
    const above = join(ROOT, 'argus.config.ts');

    expect(locateConfig(NESTED, probe(boundary, above))).toEqual({
      kind: 'package-json',
      path: boundary,
    });
  });

  it('reaches a parent config when no package.json intervenes', () => {
    const pkg = join(ROOT, 'package.json');
    const config = join(ROOT, 'argus.config.ts');

    expect(locateConfig(NESTED, probe(pkg, config))).toEqual({ kind: 'file', path: config });
  });
});

/**
 * Which directory a config file GOVERNS.
 *
 * Normally the one holding it. The exception is `.config/`, which is a
 * container for configuration and not a project: a config found at
 * `<project>/.config/argus.config.ts` configures `<project>`. Getting this
 * wrong roots discovery inside `.config/`, where there are no tests, and the
 * run fails with "no test files matched" — which reads like a bad glob rather
 * than a bad root.
 */
describe('configBaseDir', () => {
  it('is the directory holding the config file', () => {
    expect(configBaseDir(join(NESTED, 'argus.config.ts'))).toBe(NESTED);
  });

  it('steps out of a .config directory to the project it configures', () => {
    expect(configBaseDir(join(NESTED, '.config', 'argus.config.ts'))).toBe(NESTED);
  });

  it('applies the same rule to a path named with --config', () => {
    expect(configBaseDir(join(ROOT, '.config', 'anything.ts'))).toBe(ROOT);
  });

  it('leaves a directory merely ending in "config" alone', () => {
    const dir = join(NESTED, 'myconfig');

    expect(configBaseDir(join(dir, 'argus.config.ts'))).toBe(dir);
  });
});
