#!/usr/bin/env node
/**
 * @argus/cli — composition root.
 *
 * Wiring: args → resolveFrameworkPaths → provision(LocalPath) → discover(globs)
 *         → per-file: bundle + run + parse → aggregate → report → exit code.
 *
 * Runs via tsx (no build step). Add to root package.json:
 *   "argus": "tsx packages/cli/src/cli.ts"
 */

import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import type { FileResult, RunOutcome } from '@argus/core';
import { parseHermesOutput } from '@argus/core';
import { DEFAULT_ENGINE_TARGET, EsbuildBundler } from '@argus/esbuild';
import { HermesSpawnEngine, LocalPathAdapter } from '@argus/hermes';
import { CliReporter, exitCodeForSession, renderSessionSummary } from '@argus/reporter-cli';
import { foldOutcomes } from './aggregate.js';
import { parseCliArgs, USAGE } from './args.js';
import { resolveFiles } from './discover.js';
import { resolveFrameworkPaths } from './paths.js';

const errMsg = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e);

async function main(): Promise<void> {
  // 1. Parse CLI arguments
  const { patterns, timeoutMs, hermes: hermesFlagPath, help } = parseCliArgs(process.argv.slice(2));
  if (help) {
    process.stdout.write(USAGE);
    return;
  }

  // 2. Resolve framework / polyfill source paths (keyed off import.meta.url)
  const { frameworkPath, polyfillPaths } = resolveFrameworkPaths();

  // 3. Resolve Hermes binary: --hermes flag → ARGUS_HERMES env → .hermes/hermes
  const cwd = process.cwd();
  const hermesBin = resolveHermesBinary(hermesFlagPath, frameworkPath);

  // 4. Provision the binary
  const provisioner = new LocalPathAdapter(hermesBin);
  const bin = await provisioner
    .resolve({ rnVersion: '0.86.0', os: 'darwin', arch: 'arm64' })
    .catch((e) => {
      process.stderr.write(`✗ INFRASTRUCTURE FAILURE [provision] ${errMsg(e)}\n`);
      process.exit(2);
    });

  // 5. Discover test files
  const files = await resolveFiles(patterns, cwd);
  if (files.length === 0) {
    process.stderr.write(
      `✗ INFRASTRUCTURE FAILURE [discover] No test files matched the given pattern(s).\n`,
    );
    process.exit(2);
  }

  // 6. Per-file sequential run loop
  const bundler = new EsbuildBundler();
  const engine = new HermesSpawnEngine();
  const reporter = new CliReporter();

  const fileResults: FileResult[] = [];

  for (const file of files) {
    let outcome: RunOutcome;
    try {
      const bundle = await bundler
        .bundle({
          testPaths: [file],
          frameworkPath,
          polyfillPaths,
          engineTarget: DEFAULT_ENGINE_TARGET,
        })
        .catch((e) => {
          throw Object.assign(new Error(errMsg(e)), { stage: 'bundle' });
        });

      const output = await engine.run(bundle, bin, { timeoutMs });

      outcome = output.timedOut
        ? { kind: 'timeout', timeoutMs, output }
        : parseHermesOutput(output, bundle.resultNonce);
    } catch (e) {
      const stage = (e as { stage?: string }).stage === 'bundle' ? 'bundle' : 'spawn';
      outcome = {
        kind: 'infrastructure-failure',
        stage,
        message: errMsg(e),
      };
    }

    // Report per-file as it completes
    await reporter.report(outcome);
    fileResults.push({ file, outcome });
  }

  // 7. Aggregate + session summary + exit code
  const session = foldOutcomes(fileResults);
  renderSessionSummary(session);
  process.exitCode = exitCodeForSession(session);
}

/**
 * Resolves the Hermes binary path using the precedence order:
 *   --hermes flag → ARGUS_HERMES env var → {repoRoot}/.hermes/hermes
 *
 * Exits with code 2 if no readable binary is found.
 *
 * @param hermesFlagPath  Value of the --hermes CLI flag (undefined if not passed)
 * @param frameworkPath   Used to derive the repo root for the fallback path
 */
function resolveHermesBinary(hermesFlagPath: string | undefined, frameworkPath: string): string {
  // Derive repo root from frameworkPath:
  //   frameworkPath = {repoRoot}/packages/framework/src/index
  //   → join(frameworkPath, '../../../../..') would overshoot — use resolve approach
  //   frameworkPath has no extension; dirname gives packages/framework/src
  //   then ../../.. = repo root
  const frameworkDir = frameworkPath.replace(/[/\\][^/\\]+$/, ''); // dirname without path module
  const repoRoot = resolve(frameworkDir, '..', '..', '..');

  const candidates: string[] = [];
  if (hermesFlagPath) candidates.push(hermesFlagPath);
  if (process.env.ARGUS_HERMES) candidates.push(process.env.ARGUS_HERMES);
  candidates.push(resolve(repoRoot, '.hermes', 'hermes'));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.R_OK);
      return candidate;
    } catch {
      // not readable — try next
    }
  }

  const tried = candidates.join(', ');
  process.stderr.write(
    `✗ INFRASTRUCTURE FAILURE [provision] No readable Hermes binary found.\n` +
      `  Tried: ${tried}\n` +
      `  Set ARGUS_HERMES or pass --hermes <path>.\n`,
  );
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`✗ INFRASTRUCTURE FAILURE [host] ${errMsg(e)}\n`);
  process.exitCode = 2;
});
