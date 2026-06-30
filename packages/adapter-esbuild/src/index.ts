import { randomBytes } from 'node:crypto';
import type {
  BundleInput,
  Bundler,
  SealedBundle,
  SourceFile,
  TransformedCode,
  Transformer,
  TransformOptions,
} from '@argus/core';
import { build, transform } from 'esbuild';

/**
 * Default esbuild target.
 *
 * FINDING (Phase 1): esbuild's `hermes*` target is UNUSABLE — its feature table
 * marks const/let/class as unsupported on all hermes versions and then errors
 * trying to lower them. Use a standard ES level Hermes V1 supports.
 */
export const DEFAULT_ENGINE_TARGET = ['es2020'];

/**
 * Centralized Hermes syntax policy — used by BOTH the bundler and the
 * transformer so behaviour cannot diverge.
 *
 * FINDING (Phase 1): the spike build (Hermes 0.12.0, shipped in the v0.13.0
 * release) rejects native `async` functions. es2020 leaves async in place, so
 * we lower async/await (and async generators) to generator+Promise via the
 * per-feature `supported` override. This set is PER-HERMES-VERSION — Hermes V1
 * (RN 0.86) likely supports async natively (revisit with a probe-backed policy).
 */
const HERMES_SUPPORTED: Record<string, boolean> = {
  'async-await': false,
  'async-generator': false,
};

function targetFor(engineTarget: string[]): string[] {
  return engineTarget.length > 0 ? engineTarget : DEFAULT_ENGINE_TARGET;
}

/**
 * Bundler adapter (esbuild). Generates a virtual entry, then transforms AND
 * bundles in ONE esbuild build() into a sealed IIFE for Hermes.
 */
export class EsbuildBundler implements Bundler {
  async bundle(input: BundleInput): Promise<SealedBundle> {
    const resultNonce = randomBytes(12).toString('hex');
    const entry = generateVirtualEntry(input, resultNonce);
    const result = await build({
      stdin: {
        contents: entry,
        resolveDir: process.cwd(),
        sourcefile: 'argus-virtual-entry.ts',
        loader: 'ts',
      },
      bundle: true,
      format: 'iife',
      target: targetFor(input.engineTarget),
      supported: HERMES_SUPPORTED,
      platform: 'neutral',
      write: false,
      outfile: 'run.argus-bundle.js',
      sourcemap: 'external',
      legalComments: 'none',
    });
    // D1: select by explicit suffix (esbuild output ordering is not contractual).
    const jsFile = result.outputFiles.find((f) => f.path.endsWith('.js'));
    const mapFile = result.outputFiles.find((f) => f.path.endsWith('.js.map'));
    if (!jsFile) throw new Error('EsbuildBundler: esbuild produced no JS output file');
    const code = jsFile.text;
    return {
      code,
      map: mapFile?.text,
      sizeBytes: Buffer.byteLength(code, 'utf8'),
      resultNonce,
    };
  }
}

/**
 * Generate the synthetic virtual entry (SPEC §5.1):
 *   polyfills -> framework (installs globals) -> user tests (register)
 *   -> run(<nonce>).
 *
 * The nonce is inlined as a PRIVATE argument in this entry module's scope. User
 * test modules are bundled as separate module scopes and cannot read it, so the
 * result frame is unforgeable (NOT injected via a global `define`, which WOULD
 * expose it to user code).
 */
function generateVirtualEntry(input: BundleInput, resultNonce: string): string {
  const imp = (p: string): string => `import ${JSON.stringify(p)};`;
  return [
    ...input.polyfillPaths.map(imp),
    `import { run } from ${JSON.stringify(input.frameworkPath)};`,
    ...input.testPaths.map(imp),
    `run(${JSON.stringify(resultNonce)});`,
  ].join('\n');
}

/**
 * Transformer adapter (esbuild). Single-file transform — NOT used by the Phase 1
 * bundle path (which transforms+bundles in one build()). Uses the SAME Hermes
 * syntax policy as the bundler.
 */
export class EsbuildTransformer implements Transformer {
  async transform(input: SourceFile, opts: TransformOptions): Promise<TransformedCode> {
    const result = await transform(input.content, {
      loader: opts.loader ?? 'ts',
      target: targetFor(opts.engineTarget),
      supported: HERMES_SUPPORTED,
      sourcefile: input.path,
    });
    return { code: result.code };
  }
}
