import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import type {
  BundleInput,
  Bundler,
  SealedBundle,
  SourceFile,
  TransformedCode,
  Transformer,
  TransformOptions,
} from '@arguslab/core';
import { build, transform } from 'esbuild';
import { hermesClassLowering } from './hermes-class-lowering.js';
import { projectPackageAliases } from './project-packages.js';
import { hermesSyntaxPolicy } from './syntax-policy.js';

export { type HermesSyntaxPolicy, hermesSyntaxPolicy } from './syntax-policy.js';

/**
 * JSX settings for the bundle.
 *
 * Shared with the class-lowering pass, which has to re-run the JSX transform on
 * any file it strips: a `.tsx` that takes the lowering detour must come out of
 * it identical to one that did not.
 */
const JSX_OPTIONS = {
  jsx: 'automatic',
  jsxImportSource: 'react',
  jsxDev: true,
} as const;

const ESBUILD_LIVE_BINDING_GETTER = 'get: () => from[key]';
const HERMES_SAFE_LIVE_BINDING_GETTER = 'get: ((capturedKey) => () => from[capturedKey])(key)';

function captureCommonJsLiveBindingKeys(code: string): string {
  return code.replaceAll(ESBUILD_LIVE_BINDING_GETTER, HERMES_SAFE_LIVE_BINDING_GETTER);
}

/**
 * Bundler adapter (esbuild). Generates a virtual entry, then transforms AND
 * bundles in ONE esbuild build() into a sealed IIFE for Hermes.
 */
export class EsbuildBundler implements Bundler {
  async bundle(input: BundleInput): Promise<SealedBundle> {
    const resultNonce = randomBytes(12).toString('hex');
    const entry = generateVirtualEntry(input, resultNonce);
    const frameworkSourceDir = dirname(input.frameworkPath);
    const projectDir = input.projectDir ?? process.cwd();
    const rnShim = join(frameworkSourceDir, 'rn-shim');
    // One engine, one answer: the target, the per-feature overrides and whether
    // Babel runs at all all come from here, so the bundle can never be built
    // for a different VM than the one that will parse it.
    const policy = hermesSyntaxPolicy(input.engine);
    const result = await build({
      stdin: {
        contents: entry,
        resolveDir: projectDir,
        sourcefile: 'argus-virtual-entry.ts',
        loader: 'ts',
      },
      bundle: true,
      format: 'iife',
      target: policy.target,
      supported: policy.supported,
      platform: 'neutral',
      write: false,
      outfile: 'run.argus-bundle.js',
      sourcemap: 'external',
      ...JSX_OPTIONS,
      define: {
        __DEV__: 'true',
        'process.env.NODE_ENV': '"development"',
      },
      alias: {
        argus: input.componentPath,
        'react-native': rnShim,
        ...projectPackageAliases(projectDir),
      },
      // An engine that parses `class` gets no Babel pass at all, so its bundle
      // is the code the user wrote rather than a rewrite of it.
      plugins: policy.lowerClasses
        ? [
            hermesClassLowering({
              target: policy.target,
              supported: policy.supported,
              jsx: JSX_OPTIONS,
            }),
          ]
        : [],
      legalComments: 'none',
    });
    // D1: select by explicit suffix (esbuild output ordering is not contractual).
    const jsFile = result.outputFiles.find((f) => f.path.endsWith('.js'));
    const mapFile = result.outputFiles.find((f) => f.path.endsWith('.js.map'));
    if (!jsFile) throw new Error('EsbuildBundler: esbuild produced no JS output file');
    // Hermes does not preserve per-iteration bindings for esbuild's generated
    // CommonJS getter loop. Capture the key through a function parameter so
    // named imports do not all resolve to the final export.
    const code = captureCommonJsLiveBindingKeys(jsFile.text);
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
    const policy = hermesSyntaxPolicy(opts.engine);
    const result = await transform(input.content, {
      loader: opts.loader ?? 'ts',
      target: policy.target,
      supported: policy.supported,
      sourcefile: input.path,
      ...JSX_OPTIONS,
      define: {
        __DEV__: 'true',
        'process.env.NODE_ENV': '"development"',
      },
    });
    return { code: result.code };
  }
}
