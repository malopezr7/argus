import type { SourceFile, TransformedCode, TransformOptions } from '../domain/types.js';

/**
 * Port: Transformer
 *
 * Transforms one source unit (TypeScript / JSX / Flow) into Hermes-safe
 * plain JavaScript. The adapter (e.g. esbuild) lives outside this package.
 *
 * Invariants:
 *  - Output must be valid JavaScript that Hermes can parse (no TS, no JSX).
 *  - Output must respect the engineTarget so Hermes-unsupported syntax is
 *    lowered (e.g. async generators → not allowed).
 *  - Implementation must be host-agnostic: works under both Node and Bun.
 */
export interface Transformer {
  /**
   * Transform a single source file into Hermes-safe JS.
   *
   * @param input  - The source file to transform.
   * @param opts   - Transform options (engine target, JSX handling, etc.).
   * @returns A promise resolving to the transformed JavaScript code.
   */
  transform(input: SourceFile, opts: TransformOptions): Promise<TransformedCode>;
}
