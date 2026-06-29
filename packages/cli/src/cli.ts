#!/usr/bin/env node
/**
 * @argus/cli — entrypoint (not yet runnable as a published binary).
 *
 * The real composition is implemented and GREEN in `scripts/run-phase1.ts`
 * (run via `pnpm phase1 [testFile...]`). It wires the actual adapters:
 *   provision (LocalPathAdapter) → bundle (EsbuildBundler, nonce-framed) →
 *   run (HermesSpawnEngine, file mode + timeout) → parse (parseHermesOutput) →
 *   report (CliReporter) → exit code (exitCodeFor).
 *
 * Remaining before this packaged binary works (Phase 2):
 *  - Resolve @argus/framework + polyfill module paths to bundle into the user's
 *    test bundle (require.resolve / shipped blob) instead of hardcoded repo paths.
 *  - Provisioning (PrebuiltAdapter) so ARGUS_HERMES is not required.
 *  - Test discovery (globs), CLI flags, config.
 */
function main(): void {
  process.stderr.write(
    'argus: packaged CLI not wired yet — use `pnpm phase1 [testFile...]` (dev harness). ' +
      'See scripts/run-phase1.ts.\n',
  );
  process.exitCode = 2;
}

main();
