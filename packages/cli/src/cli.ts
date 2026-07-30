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
import { EsbuildBundler } from '@arguslab/esbuild';
import { HermesSpawnEngine } from '@arguslab/hermes/hermes-spawn-engine.js';
import {
  exitCodeForSession,
  renderFileOutcome,
  renderSessionSummary,
} from '@arguslab/reporter-cli';
import { remapStacks } from '@arguslab/sourcemap';
import { foldOutcomes } from './aggregate.js';
import { defaultConcurrency, parseCliArgs, USAGE, UsageError } from './args.js';
import { loadConfig } from './config/load.js';
import { mergeConfig } from './config/merge.js';
import { ConfigError } from './config/validate.js';
import { resolveFiles } from './discover.js';
import { errMsg } from './errors.js';
import { resolveFrameworkPaths } from './paths.js';
import { mapPool } from './pool.js';
import { provisionHermes } from './provision/provision.js';
import { resolvePackageVersion } from './version.js';

async function main(): Promise<void> {
  // 1. Parse CLI arguments
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      // The usage text goes with the error, on stderr: a user who mistyped a
      // flag needs to see the real ones, and stdout is where the report goes.
      process.stderr.write(`✗ Usage error: ${e.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }

  // Both answer without touching the project, the config or a Hermes binary —
  // `argus --version` must work in a directory where a real run cannot.
  if (parsed.version) {
    process.stdout.write(`${resolvePackageVersion()}\n`);
    return;
  }

  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }

  // 2. Load the config file, then fold defaults, config, environment and flags
  //    into one answer per setting. Everything below reads `settings` only —
  //    no other step re-decides where a value came from.
  const cwd = process.cwd();
  let settings: ReturnType<typeof mergeConfig>;
  try {
    const loaded = await loadConfig({
      startDir: cwd,
      ...(parsed.config === undefined ? {} : { explicitPath: parsed.config }),
    });
    settings = mergeConfig({
      loaded,
      flags: parsed,
      env: process.env,
      fallbackConcurrency: defaultConcurrency(),
    });
  } catch (e) {
    // A config that cannot be used never falls back to the defaults: running
    // under settings the user did not choose is the failure this layer exists
    // to prevent, and it would be invisible in the output.
    if (e instanceof ConfigError) {
      process.stderr.write(`✗ Config error: ${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }

  const { timeoutMs, concurrency } = settings;

  // 3. Resolve framework / polyfill source paths (keyed off import.meta.url)
  const { componentPath, frameworkPath, polyfillPaths } = resolveFrameworkPaths();

  // 4. Provision Hermes: resolve the engine this project targets, then walk the
  //    source chain (explicit → cache → bundled → prebuilt → source build).
  const provisioned = await provisionHermes({
    ...(settings.hermes.path === undefined || settings.hermes.pathOrigin === undefined
      ? {}
      : { explicitHermes: { path: settings.hermes.path, origin: settings.hermes.pathOrigin } }),
    ...(settings.hermes.engine === undefined ? {} : { engine: settings.hermes.engine }),
    allowSourceBuild: settings.hermes.provision,
    startDir: settings.root,
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
  // Which engine will parse the bundle. Read once here, beside the binary it
  // describes, because the two must never come from different runs.
  const engine = provisioned.engine;

  // 5. Discover test files
  const files = await resolveFiles(settings.include, settings.root, settings.exclude);
  if (files.length === 0) {
    // `process.exitCode` + return, never `process.exit()`: the line above is
    // still in the stderr pipe buffer when the output is redirected, and
    // `process.exit` discards it. That left `argus 'typo/**' 2> log` reporting
    // a bare exit 2 with nothing in the log to explain it.
    process.stderr.write(
      `✗ INFRASTRUCTURE FAILURE [discover] No test files matched the given pattern(s).\n`,
    );
    process.exitCode = 2;
    return;
  }

  // 6. Per-file concurrent run via bounded pool
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
          // The engine that was actually provisioned, NOT a constant: it is
          // what decides whether `class` survives into the bundle, and the
          // legacy VM cannot parse `class` in any form.
          engine,
          // React is resolved from the project under test, which is the
          // discovery root rather than the working directory: in a monorepo
          // with per-package React versions, `root: 'packages/app'` must
          // resolve that package's React. Node still walks up to a hoisted one.
          projectDir: settings.root,
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

  // 7. Aggregate + session summary + exit code
  const session = foldOutcomes(fileResults);
  renderSessionSummary(session);
  process.exitCode = exitCodeForSession(session);
}

main().catch((e) => {
  process.stderr.write(`✗ INFRASTRUCTURE FAILURE [host] ${errMsg(e)}\n`);
  process.exitCode = 2;
});
