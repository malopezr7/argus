import type { BundleInput, SealedBundle } from '../domain/types.js';

/**
 * Port: Bundler
 *
 * Flattens the env polyfills, the in-Hermes micro-framework, and all user test
 * files into ONE sealed, self-contained bundle that Hermes can execute without
 * a module resolver.
 *
 * The bundler GENERATES a synthetic virtual entry (see BundleInput) that wires
 * polyfills → framework globals → user tests → run() → framed result line.
 *
 * Key constraints:
 *  - Output format MUST be IIFE with bundle:true.
 *  - Engine target MUST be set (e.g. 'es2020'). NOTE: esbuild's `hermes*` target
 *    is unusable (it errors lowering const/let/class) — use a standard ES level.
 *    The target is syntax-only; API polyfills are supplied via polyfillPaths.
 *  - No runtime module resolution may remain in the output.
 */
export interface Bundler {
  /**
   * Bundle polyfills + framework + tests into a sealed IIFE via a virtual entry.
   *
   * @param input - The test files, framework, polyfills, and engine target.
   * @returns A promise resolving to the sealed, runnable bundle.
   */
  bundle(input: BundleInput): Promise<SealedBundle>;
}
