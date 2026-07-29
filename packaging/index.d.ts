/// <reference path="./argus.d.ts" />

/**
 * The importable surface of `@arguslab/argus`.
 *
 * Two different things need types, and they are delivered together on purpose:
 *
 *   1. `describe` / `test` / `expect` are GLOBALS installed by the framework
 *      inside Hermes, and the virtual `argus` module is rewritten by an esbuild
 *      alias at bundle time. Both are declared in `argus.d.ts`, which only
 *      works because that file has no top-level import or export — that is what
 *      makes its `declare module` ambient rather than a module augmentation.
 *
 *   2. `defineConfig` is an ordinary runtime export, which requires this file
 *      to BE a module.
 *
 * A module cannot declare ambient globals, so the two cannot live in one file.
 * The triple-slash reference above is what bridges them: this file stays a
 * module, `argus.d.ts` stays a global script, and a single
 *
 *   { "compilerOptions": { "types": ["@arguslab/argus"] } }
 *
 * or one `/// <reference types="@arguslab/argus" />` delivers both.
 */

/** Which Hermes engine to run on. */
export type HermesEngine = 'legacy' | 'v1';

/** How Argus should obtain the Hermes binary the tests run on. */
export interface ArgusHermesConfig {
  /**
   * Path to a Hermes binary to use outright. Relative paths resolve against
   * the config file. Both `--hermes` and `ARGUS_HERMES` override this.
   */
  path?: string;
  /** Which engine to target. Omit to use whichever engine the project pins. */
  engine?: HermesEngine;
  /**
   * Authorise building Hermes from source when nothing else can supply a
   * binary. Needs git, cmake and ninja, and takes minutes.
   */
  provision?: boolean;
}

/**
 * Everything Argus can be configured with. Every field is optional.
 *
 * Precedence, lowest to highest: these defaults, then `package.json#argus`,
 * then the config file, then `ARGUS_HERMES`, then CLI flags. A flag always
 * wins.
 */
export interface ArgusConfig {
  /**
   * Globs selecting test files, relative to `root` — or absolute.
   * Default: `['**\/*.test.ts', '**\/*.test.tsx']`.
   * Positional CLI arguments override this.
   */
  include?: string[];
  /**
   * Globs excluded from discovery.
   * Default: `node_modules`, `dist`, `build`, `coverage` and `.git`.
   */
  exclude?: string[];
  /**
   * Directory globs are resolved against. Defaults to the config file's own
   * directory, or the working directory when there is no config file. A
   * relative value resolves against the config file.
   */
  root?: string;
  /** Per-file Hermes timeout in milliseconds. Default: 10000. */
  timeout?: number;
  /**
   * How many files may run in parallel; 1 runs them sequentially.
   * Default: the CPU count, capped at 8.
   */
  concurrency?: number;
  /** Which Hermes binary to run on, and how far Argus may go to obtain one. */
  hermes?: ArgusHermesConfig;
}

/**
 * Identity function that gives a config file its types.
 *
 * Nothing happens at run time; it exists so the object is checked and
 * completed by the editor:
 *
 *   import { defineConfig } from '@arguslab/argus';
 *
 *   export default defineConfig({
 *     include: ['src/**\/*.test.ts'],
 *     timeout: 30000,
 *   });
 *
 * Argus loads `argus.config.ts` with Node's native type stripping, which
 * erases types without compiling. `enum` and `namespace` emit real code and so
 * cannot appear in a config file; use `argus.config.js` if you need them.
 */
export declare function defineConfig(config: ArgusConfig): ArgusConfig;
