/**
 * The Argus configuration contract.
 *
 * This module is the PUBLIC ENTRY of the published package: `defineConfig` is
 * what a user imports from `@arguslab/argus`, and `ArgusConfig` is the type
 * their config file is checked against. That gives it one unusual constraint —
 * it must have no VALUE imports at all.
 *
 * The reason is import cost. A user writing a config file should not pay for
 * the runner: pulling in the barrel would drag esbuild, Babel and the whole
 * host graph into the import chain of a file whose only job is to describe five
 * options. `import type` is erased at build time, so the type below costs
 * nothing; a value import would not be. `scripts/build-package.ts` asserts the
 * emitted bundle stays small and free of those dependencies rather than
 * trusting this comment.
 *
 * Every option here corresponds to behaviour that already exists. Options for
 * features that do not exist yet are deliberately absent: a config key is a
 * compatibility obligation from the moment it ships, and one that does nothing
 * is the worst kind.
 */

import type { HermesEngine } from './hermes-version.js';

/** How Argus should obtain the Hermes binary the tests run on. */
export interface ArgusHermesConfig {
  /**
   * Path to a Hermes binary to use outright.
   *
   * The `--hermes` flag and `ARGUS_HERMES` both override this: a value written
   * into a file that is committed to the repo should not beat one a developer
   * typed for this run.
   */
  path?: string;
  /** Which engine to target. Omit to use whichever engine the project pins. */
  engine?: HermesEngine;
  /**
   * Authorise building Hermes from source when nothing else can supply a
   * binary. Off by default because the build takes minutes and needs a
   * toolchain (git, cmake, ninja) that is not assumed to be present.
   */
  provision?: boolean;
}

/** Everything Argus can be configured with. Every field is optional. */
export interface ArgusConfig {
  /** Globs selecting test files, relative to `root`. */
  include?: string[];
  /** Globs excluded from discovery, applied to every `include` result. */
  exclude?: string[];
  /**
   * Directory globs are resolved against.
   *
   * Defaults to the directory holding the config file, NOT the working
   * directory — so `argus` behaves the same whether it is run from the repo
   * root or from a subdirectory. A relative value is resolved against the
   * config file's directory for the same reason.
   */
  root?: string;
  /** Per-file Hermes timeout, in milliseconds. */
  timeout?: number;
  /** How many files may run in parallel. 1 runs them sequentially. */
  concurrency?: number;
  /** Which Hermes binary to run on, and how far Argus may go to obtain one. */
  hermes?: ArgusHermesConfig;
}

/** Test file globs used when the config does not name any. */
export const DEFAULT_INCLUDE: readonly string[] = ['**/*.test.ts', '**/*.test.tsx'];

/**
 * Directories never searched for tests.
 *
 * `dist`, `build` and `coverage` are here because a test file compiled into a
 * build directory is a COPY: discovering it runs the same test twice, and the
 * copy is the one whose stack traces point at generated code. `.git` holds no
 * source at all, and walking it is pure cost.
 */
export const DEFAULT_EXCLUDE: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.git/**',
];

/** Per-file Hermes timeout when the config does not set one, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Upper bound on the default concurrency.
 *
 * Each file is a Hermes subprocess, so parallelism is bounded by memory and I/O
 * long before it is bounded by cores. The cap keeps a 64-core CI machine from
 * spawning 64 VMs to run a handful of files.
 */
export const DEFAULT_CONCURRENCY_CAP = 8;

/**
 * Identity function that gives a config file its types.
 *
 * It exists so `export default defineConfig({ ... })` is checked and completed
 * by the editor without the user writing a type annotation or importing a type.
 * It does nothing at run time, on purpose.
 */
export function defineConfig(config: ArgusConfig): ArgusConfig {
  return config;
}
