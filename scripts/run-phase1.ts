/**
 * Phase 1 composition root (run via tsx, no build step).
 *
 * Wires the REAL adapters through all layers for one hardcoded test file:
 *   LocalPath provision -> esbuild bundle (nonce) -> Hermes spawn (file mode,
 *   timeout) -> core protocol parse -> CLI report -> exit code.
 *
 * Imports adapters/core by relative source path so tsx runs them without a
 * build; the adapters' only `@argus/core` imports are type-only (erased).
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ENGINE_TARGET, EsbuildBundler } from '../packages/adapter-esbuild/src/index.js';
import { HermesSpawnEngine } from '../packages/adapter-hermes/src/hermes-spawn-engine.js';
import { LocalPathAdapter } from '../packages/adapter-hermes/src/local-path-adapter.js';
import type { RunOutcome } from '../packages/core/src/index.js';
import { parseHermesOutput } from '../packages/core/src/result-protocol.js';
import { CliReporter, exitCodeFor } from '../packages/reporter-cli/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const HERMES = process.env.ARGUS_HERMES ?? join(REPO, '.hermes', 'hermes');
const TIMEOUT_MS = 10_000;

const errMsg = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e);

async function main(): Promise<void> {
  const provisioner = new LocalPathAdapter(HERMES);
  const bundler = new EsbuildBundler();
  const engine = new HermesSpawnEngine();
  const reporter = new CliReporter();

  let outcome: RunOutcome;

  try {
    const bin = await provisioner.resolve({ rnVersion: '0.86.0', os: 'darwin', arch: 'arm64' });

    const cliArgs = process.argv.slice(2);
    const testPaths =
      cliArgs.length > 0
        ? cliArgs.map((p) => resolve(process.cwd(), p))
        : [join(REPO, 'examples/math.test')];

    const bundle = await bundler
      .bundle({
        polyfillPaths: [join(REPO, 'packages/framework/src/polyfill')],
        frameworkPath: join(REPO, 'packages/framework/src/index'),
        componentPath: join(REPO, 'packages/rntl/src/index'),
        testPaths,
        engineTarget: DEFAULT_ENGINE_TARGET,
      })
      .catch((e) => {
        throw Object.assign(new Error(errMsg(e)), { stage: 'bundle' });
      });

    const output = await engine.run(bundle, bin, { timeoutMs: TIMEOUT_MS });
    process.stdout.write(
      `bundle: ${bundle.sizeBytes} bytes · hermes spawn: ${output.durationMs.toFixed(1)} ms\n\n`,
    );

    outcome = output.timedOut
      ? { kind: 'timeout', timeoutMs: TIMEOUT_MS, output }
      : parseHermesOutput(output, bundle.resultNonce);
  } catch (e) {
    const stage = (e as { stage?: string }).stage === 'bundle' ? 'bundle' : 'provision';
    outcome = { kind: 'infrastructure-failure', stage, message: errMsg(e) };
  }

  await reporter.report(outcome);
  process.exitCode = exitCodeFor(outcome);
}

main().catch((e) => {
  process.stderr.write(`✗ INFRASTRUCTURE FAILURE [host] ${errMsg(e)}\n`);
  process.exitCode = 2;
});
