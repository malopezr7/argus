#!/usr/bin/env node
/**
 * @arguslab/cli — composition root.
 *
 * Wiring: args → resolveFrameworkPaths → provisionHermes → discover(globs)
 *         → mapPool(files, concurrency, runFile) → ordered render → aggregate → exit code.
 *
 * Runs via tsx (no build step). Add to root package.json:
 *   "argus": "tsx packages/cli/src/cli.ts"
 */

import { homedir } from 'node:os';
import type { FileResult, RunOutcome } from '@arguslab/core';
import { parseHermesOutput } from '@arguslab/core';
import { DEFAULT_ENGINE_TARGET, EsbuildBundler } from '@arguslab/esbuild';
import { HermesSpawnEngine } from '@arguslab/hermes/hermes-spawn-engine.js';
import { exitCodeForSession, renderFileOutcome, renderSessionSummary } from '@arguslab/reporter-cli';
import { remapStacks } from '@arguslab/sourcemap';
import { foldOutcomes } from './aggregate.js';
import { parseCliArgs, USAGE, UsageError } from './args.js';
import { resolveFiles } from './discover.js';
import { errMsg } from './errors.js';
import { resolveFrameworkPaths } from './paths.js';
import { mapPool } from './pool.js';
import { provisionHermes } from './provision/provision.js';

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

  const {
    patterns,
    timeoutMs,
    hermes: hermesFlagPath,
    engine,
    provision,
    help,
    concurrency,
  } = parsed;

  if (help) {
    process.stdout.write(USAGE);
    return;
  }

  // 2. Resolve framework / polyfill source paths (keyed off import.meta.url)
  const { componentPath, frameworkPath, polyfillPaths } = resolveFrameworkPaths();

  // 3. Provision Hermes: resolve the engine this project targets, then walk the
  //    source chain (explicit → cache → bundled → prebuilt → source build).
  const cwd = process.cwd();
  const provisioned = await provisionHermes({
    ...(hermesFlagPath === undefined ? {} : { hermesFlagPath }),
    ...(process.env.ARGUS_HERMES === undefined ? {} : { hermesEnvPath: process.env.ARGUS_HERMES }),
    ...(engine === undefined ? {} : { engine }),
    allowSourceBuild: provision,
    startDir: cwd,
    homeDir: homedir(),
    platform: process.platform,
    arch: process.arch,
  });

  if (provisioned.kind === 'usage-error') {
    process.stderr.write(`✗ Usage error: ${provisioned.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (provisioned.kind === 'failed') {
    process.stderr.write(provisioned.message);
    process.exitCode = 2;
    return;
  }

  // The engine identity is written before any test output so a CI log records
  // which engine the results below actually came from.
  process.stdout.write(provisioned.summary);
  if (provisioned.warning !== undefined) process.stderr.write(provisioned.warning);
  const bin = provisioned.binary;

  // 4. Discover test files
  const files = await resolveFiles(patterns, cwd);
  if (files.length === 0) {
    process.stderr.write(
      `✗ INFRASTRUCTURE FAILURE [discover] No test files matched the given pattern(s).\n`,
    );
    process.exit(2);
  }

  // 5. Per-file concurrent run via bounded pool
  const bundler = new EsbuildBundler();
  const spawnEngine = new HermesSpawnEngine();

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
          componentPath,
          polyfillPaths,
          engineTarget: DEFAULT_ENGINE_TARGET,
        })
        .catch((e) => {
          throw Object.assign(new Error(errMsg(e)), { stage: 'bundle' });
        });

      const output = await spawnEngine.run(bundle, bin, { timeoutMs });

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

  // 6. Aggregate + session summary + exit code
  const session = foldOutcomes(fileResults);
  renderSessionSummary(session);
  process.exitCode = exitCodeForSession(session);
}

main().catch((e) => {
  process.stderr.write(`✗ INFRASTRUCTURE FAILURE [host] ${errMsg(e)}\n`);
  process.exitCode = 2;
});
