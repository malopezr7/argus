/**
 * Builds Hermes at an explicit tag and reports where the binaries landed.
 *
 *   pnpm exec tsx scripts/build-hermes.ts --tag hermes-v250829098.0.16
 *
 * Thin on purpose. The work is done by `SourceBuildAdapter`, which is the same
 * code path a user without a published prebuilt takes: it checks for cmake and
 * ninja, shallow-clones facebook/hermes at the tag, and configures with the
 * flag set React Native uses (from `@arguslab/core`'s pure builders, so the flags
 * are asserted by unit tests rather than only by a multi-minute build). Having
 * CI build through a different implementation than users do would let the two
 * drift, and the drift would only ever surface as a user-only failure.
 *
 * When `GITHUB_OUTPUT` is set the binary directory is exported as `bin-dir`, so
 * the workflow consumes a variable instead of parsing stdout.
 */

import { appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { SourceBuildAdapter } from '../packages/adapter-hermes/src/source-build-adapter.js';
import { parseHermesTag } from '../packages/core/src/index.js';
import { fail, log, pass } from './lib/exec.js';

function hostOs(): 'darwin' | 'linux' | 'win32' {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'win32') return 'win32';
  return fail(`unsupported build host: ${process.platform}`);
}

function hostArch(): 'arm64' | 'x64' {
  if (process.arch === 'arm64') return 'arm64';
  if (process.arch === 'x64') return 'x64';
  return fail(`unsupported build host architecture: ${process.arch}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { tag: { type: 'string' } } });

  const tag = values.tag;
  if (tag === undefined) fail('usage: build-hermes --tag <hermes-tag>');

  const ref = parseHermesTag(tag);
  if (ref === undefined) fail(`unparsable Hermes ref: ${tag}`);

  log(`building Hermes ${ref.tag} (${ref.engine} engine) on ${hostOs()}-${hostArch()}`);

  // `rnVersion` is required by `EngineTarget` but unread here: the adapter only
  // consults it to discover a tag, and this passes one outright.
  const binary = await new SourceBuildAdapter(ref.tag).resolve({
    rnVersion: '',
    os: hostOs(),
    arch: hostArch(),
  });

  const binDir = dirname(binary.path);
  pass(`built ${binDir}`);
  pass(
    `reports release ${binary.releaseVersion ?? '(none)'}, bytecode ${binary.bytecodeVersion ?? '(none)'}`,
  );

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput !== undefined && githubOutput.length > 0) {
    appendFileSync(githubOutput, `bin-dir=${binDir}\n`);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
