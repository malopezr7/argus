#!/usr/bin/env node
/**
 * @argus/cli — composition root.
 *
 * Wiring: args → resolveFrameworkPaths → provision(LocalPath) → discover(globs)
 *         → mapPool(files, concurrency, runFile) → ordered render → aggregate → exit code.
 *
 * Runs via tsx (no build step). Add to root package.json:
 *   "argus": "tsx packages/cli/src/cli.ts"
 */

import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import type { FileResult, RunOutcome } from '@argus/core';
import { parseHermesOutput } from '@argus/core';
import { DEFAULT_ENGINE_TARGET, EsbuildBundler } from '@argus/esbuild';
import { HermesSpawnEngine } from '@argus/hermes/hermes-spawn-engine.js';
import { LocalPathAdapter } from '@argus/hermes/local-path-adapter.js';
import { exitCodeForSession, renderFileOutcome, renderSessionSummary } from '@argus/reporter-cli';
import { remapStacks } from '@argus/sourcemap';
import { foldOutcomes } from './aggregate.js';
import { parseCliArgs, USAGE, UsageError } from './args.js';
import { resolveFiles } from './discover.js';
import { resolveFrameworkPaths } from './paths.js';
import { mapPool } from './pool.js';

const errMsg = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e);

async function main(): Promise<void> {
  // 1. Parse CLI arguments
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`✗ Usage error: ${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }

  const { patterns, timeoutMs, hermes: hermesFlagPath, help, concurrency } = parsed;

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

  // 6. Per-file concurrent run via bounded pool
  const bundler = new EsbuildBundler();
  const engine = new HermesSpawnEngine();

  /**
   * runFile is TOTAL — every throw/timeout resolves to a RunOutcome.
   * This is the isolation boundary that keeps mapPool from rejecting.
   * ADR-5: a throwing worker is a caller bug; runFile never throws.
   */
  async function runFile(file: string): Promise<RunOutcome> {
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

      if (output.timedOut) return { kind: 'timeout', timeoutMs, output };

      const outcome = parseHermesOutput(output, bundle.resultNonce);
      if (outcome.kind === 'passed' || outcome.kind === 'failed') {
        const result = await remapStacks(outcome.result, bundle.map);
        return { ...outcome, result };
      }
      return outcome;
    } catch (e) {
      const stage = (e as { stage?: string }).stage === 'bundle' ? 'bundle' : 'spawn';
      return {
        kind: 'infrastructure-failure',
        stage,
        message: errMsg(e),
      };
    }
  }

  const outcomes = await mapPool(files, concurrency, runFile);

  // Build FileResult[] in discovery order, then flush output in that order
  const fileResults: FileResult[] = files.map((file, i) => ({ file, outcome: outcomes[i] }));
  for (const { outcome } of fileResults) renderFileOutcome(outcome);

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
