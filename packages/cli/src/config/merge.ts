import { isAbsolute, resolve } from 'node:path';
import type { ArgusConfig, HermesEngine } from '@arguslab/core';
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, DEFAULT_TIMEOUT_MS } from '@arguslab/core';
import type { CliArgs } from '../args.js';
import type { ExplicitOrigin } from '../provision/chain.js';
import type { LoadedConfig } from './load.js';

/**
 * Deciding which value wins.
 *
 * Lowest to highest: built-in defaults, then the config file (or the
 * `package.json` field — resolution already picked exactly one of those), then
 * the environment, then CLI flags. The ordering follows how specific and how
 * deliberate each source is: a flag is typed for this one run and must always
 * win over a file that is committed and applies to everybody.
 *
 * This is where defaults are applied, and the only place. That is why `CliArgs`
 * leaves an unpassed flag absent rather than pre-filled — a default applied in
 * the parser is indistinguishable from a value the user typed, and would beat
 * the config file every time.
 *
 * Pure: every input is a parameter, so the whole precedence table is testable
 * without a filesystem, an environment or a process.
 */

/** Everything the run needs, with every question already answered. */
export interface ResolvedRunConfig {
  /** Absolute directory globs are resolved against. */
  root: string;
  /** Globs selecting test files. */
  include: readonly string[];
  /** Globs removed from the results. */
  exclude: readonly string[];
  /** Per-file Hermes timeout, in milliseconds. */
  timeoutMs: number;
  /** How many files may run at once. */
  concurrency: number;
  hermes: {
    /** An explicit binary path, if any source named one. */
    path?: string;
    /** Which source named it — reported back to the user verbatim. */
    pathOrigin?: ExplicitOrigin;
    /** Engine override, if any source named one. */
    engine?: HermesEngine;
    /** Whether a source build is authorised. */
    provision: boolean;
  };
}

export interface MergeInput {
  loaded: Pick<LoadedConfig, 'config' | 'baseDir'>;
  flags: CliArgs;
  /** Only `ARGUS_HERMES` is read; passed in rather than reached for. */
  env: { ARGUS_HERMES?: string };
  /** Concurrency to use when neither the flag nor the config names one. */
  fallbackConcurrency: number;
}

/**
 * Resolve a path that came out of a config file.
 *
 * Relative to the CONFIG FILE, not the working directory: a config is a file,
 * and a path written inside it that changed meaning depending on where `argus`
 * was invoked from would be a trap. Paths from a flag or the environment are
 * left alone — those are typed at a shell, where relative already means
 * relative to the working directory.
 */
function fromConfigDir(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

/** Resolve the Hermes binary path and record which source supplied it. */
function resolveHermesPath(
  input: MergeInput,
  hermes: ArgusConfig['hermes'],
): Pick<ResolvedRunConfig['hermes'], 'path' | 'pathOrigin'> {
  if (input.flags.hermes !== undefined && input.flags.hermes !== '') {
    return { path: input.flags.hermes, pathOrigin: 'flag' };
  }
  // An empty ARGUS_HERMES is an unset variable that happens to be exported,
  // not a request to run the binary at "".
  if (input.env.ARGUS_HERMES !== undefined && input.env.ARGUS_HERMES !== '') {
    return { path: input.env.ARGUS_HERMES, pathOrigin: 'env' };
  }
  if (hermes?.path !== undefined) {
    return { path: fromConfigDir(input.loaded.baseDir, hermes.path), pathOrigin: 'config' };
  }
  return {};
}

/** Fold defaults, config, environment and flags into one answer per setting. */
export function mergeConfig(input: MergeInput): ResolvedRunConfig {
  const { config, baseDir } = input.loaded;
  const { flags } = input;
  const hermes = config.hermes;

  // Positional globs are "provided" exactly when there is at least one; there
  // is no way to pass an empty positional list, so the two never collide.
  const include = flags.patterns.length > 0 ? flags.patterns : (config.include ?? DEFAULT_INCLUDE);

  const engine = flags.engine ?? hermes?.engine;
  const provision = flags.provision ?? hermes?.provision ?? false;

  return {
    root: config.root === undefined ? baseDir : fromConfigDir(baseDir, config.root),
    include,
    exclude: config.exclude ?? DEFAULT_EXCLUDE,
    timeoutMs: flags.timeoutMs ?? config.timeout ?? DEFAULT_TIMEOUT_MS,
    concurrency: flags.concurrency ?? config.concurrency ?? input.fallbackConcurrency,
    hermes: {
      ...resolveHermesPath(input, hermes),
      ...(engine === undefined ? {} : { engine }),
      provision,
    },
  };
}
