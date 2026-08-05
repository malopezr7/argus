import { join } from 'node:path';
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, DEFAULT_TIMEOUT_MS } from '@arguslab/core';
import { describe, expect, it } from 'vitest';
import type { CliArgs } from '../args.js';
import type { LoadedConfig } from '../config/load.js';
import { mergeConfig } from '../config/merge.js';

const BASE = join('/', 'repo');
const FALLBACK_CONCURRENCY = 4;

function merge(
  config: LoadedConfig['config'] = {},
  flags: Partial<CliArgs> = {},
  env: { ARGUS_HERMES?: string } = {},
  baseDir = BASE,
) {
  return mergeConfig({
    loaded: { config, baseDir },
    flags: { patterns: [], help: false, version: false, update: false, ...flags },
    env,
    fallbackConcurrency: FALLBACK_CONCURRENCY,
  });
}

describe('mergeConfig — defaults', () => {
  it('uses the built-in globs when nothing supplies any', () => {
    const resolved = merge();

    expect(resolved.include).toEqual(DEFAULT_INCLUDE);
    expect(resolved.exclude).toEqual(DEFAULT_EXCLUDE);
  });

  it('uses the built-in timeout and the supplied fallback concurrency', () => {
    const resolved = merge();

    expect(resolved.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolved.concurrency).toBe(FALLBACK_CONCURRENCY);
  });

  it('roots discovery at the base directory', () => {
    expect(merge().root).toBe(BASE);
  });

  it('leaves Hermes entirely to the provisioning chain', () => {
    const resolved = merge();

    expect(resolved.hermes.path).toBeUndefined();
    expect(resolved.hermes.engine).toBeUndefined();
    expect(resolved.hermes.provision).toBe(false);
  });
});

describe('mergeConfig — the config file over the defaults', () => {
  it('takes include, exclude, timeout and concurrency from the config', () => {
    const resolved = merge({
      include: ['src/**/*.spec.ts'],
      exclude: ['**/fixtures/**'],
      timeout: 30_000,
      concurrency: 2,
    });

    expect(resolved.include).toEqual(['src/**/*.spec.ts']);
    expect(resolved.exclude).toEqual(['**/fixtures/**']);
    expect(resolved.timeoutMs).toBe(30_000);
    expect(resolved.concurrency).toBe(2);
  });

  /**
   * A relative `root` is resolved against the config file, not the working
   * directory, so the same config means the same thing from anywhere.
   */
  it('resolves a relative root against the config file directory', () => {
    expect(merge({ root: 'packages/app' }).root).toBe(join(BASE, 'packages', 'app'));
  });

  it('keeps an absolute root as given', () => {
    const absolute = join('/', 'elsewhere');

    expect(merge({ root: absolute }).root).toBe(absolute);
  });

  it('takes the Hermes settings from the config', () => {
    const resolved = merge({ hermes: { engine: 'legacy', provision: true } });

    expect(resolved.hermes.engine).toBe('legacy');
    expect(resolved.hermes.provision).toBe(true);
  });

  it('resolves a relative hermes path against the config file directory', () => {
    const resolved = merge({ hermes: { path: './.hermes/hermes' } });

    expect(resolved.hermes.path).toBe(join(BASE, '.hermes', 'hermes'));
    expect(resolved.hermes.pathOrigin).toBe('config');
  });
});

describe('mergeConfig — a CLI flag beats the config file', () => {
  it('positional globs beat include', () => {
    const resolved = merge(
      { include: ['from/config/**/*.test.ts'] },
      {
        patterns: ['from/cli/**/*.test.ts'],
      },
    );

    expect(resolved.include).toEqual(['from/cli/**/*.test.ts']);
  });

  it('no positional globs leaves the config include in force', () => {
    const resolved = merge({ include: ['from/config/**/*.test.ts'] }, { patterns: [] });

    expect(resolved.include).toEqual(['from/config/**/*.test.ts']);
  });

  it('--timeout beats the config timeout', () => {
    expect(merge({ timeout: 30_000 }, { timeoutMs: 1_500 }).timeoutMs).toBe(1_500);
  });

  it('--concurrency beats the config concurrency', () => {
    expect(merge({ concurrency: 2 }, { concurrency: 7 }).concurrency).toBe(7);
  });

  it('--engine beats the config engine', () => {
    expect(merge({ hermes: { engine: 'legacy' } }, { engine: 'v1' }).hermes.engine).toBe('v1');
  });

  it('--provision turns on a source build the config left off', () => {
    expect(merge({ hermes: { provision: false } }, { provision: true }).hermes.provision).toBe(
      true,
    );
  });

  /**
   * An absent `--provision` must not read as `false` and switch off what the
   * config turned on — that is the difference between "not asked" and "asked
   * for no".
   */
  it('an absent --provision leaves the config value alone', () => {
    expect(merge({ hermes: { provision: true } }, {}).hermes.provision).toBe(true);
  });
});

describe('mergeConfig — the Hermes binary path', () => {
  const FLAG = join('/', 'flag', 'hermes');
  const ENV = join('/', 'env', 'hermes');
  const CONFIG = join('/', 'config', 'hermes');

  it('takes --hermes over everything and records where it came from', () => {
    const resolved = merge({ hermes: { path: CONFIG } }, { hermes: FLAG }, { ARGUS_HERMES: ENV });

    expect(resolved.hermes.path).toBe(FLAG);
    expect(resolved.hermes.pathOrigin).toBe('flag');
  });

  /**
   * A path typed for this run beats one committed to the repo, so ARGUS_HERMES
   * sits above the config file and below the flag.
   */
  it('takes ARGUS_HERMES over the config file', () => {
    const resolved = merge({ hermes: { path: CONFIG } }, {}, { ARGUS_HERMES: ENV });

    expect(resolved.hermes.path).toBe(ENV);
    expect(resolved.hermes.pathOrigin).toBe('env');
  });

  it('falls back to the config file when neither is set', () => {
    const resolved = merge({ hermes: { path: CONFIG } }, {}, {});

    expect(resolved.hermes.path).toBe(CONFIG);
    expect(resolved.hermes.pathOrigin).toBe('config');
  });

  it('ignores an empty ARGUS_HERMES rather than treating it as a path', () => {
    const resolved = merge({ hermes: { path: CONFIG } }, {}, { ARGUS_HERMES: '' });

    expect(resolved.hermes.path).toBe(CONFIG);
  });
});
