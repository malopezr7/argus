/**
 * Process and hashing helpers shared by the Hermes packaging scripts.
 *
 * Synchronous throughout: these scripts are linear pipelines run one step at a
 * time by CI, and `spawnSync` keeps the control flow readable with no benefit
 * lost — there is nothing to overlap.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeSync } from 'node:fs';

/** `npm pack --json` and `hermes --version` both out-talk the 1 MB default. */
const MAX_BUFFER = 64 * 1024 * 1024;

export interface CommandResult {
  /** Exit status, or -1 when the process could not be spawned at all. */
  status: number;
  stdout: string;
  stderr: string;
}

/** Run a command to completion. Never throws — inspect `status`. */
export function run(command: string, args: readonly string[], cwd?: string): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  if (result.error !== undefined) {
    return { status: -1, stdout: '', stderr: result.error.message };
  }

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Run a command, aborting the script with its output when it fails. */
export function runOrFail(command: string, args: readonly string[], cwd?: string): CommandResult {
  const result = run(command, args, cwd);
  if (result.status === 0) return result;

  const detail = result.stderr.trim().length > 0 ? result.stderr.trim() : result.stdout.trim();
  fail(`\`${command} ${args.join(' ')}\` exited ${result.status}\n${detail}`);
}

/** Hex SHA-256 of a file's contents. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Progress line.
 *
 * Written SYNCHRONOUSLY, because `fail()` below ends the process with
 * `process.exit`, which discards whatever is still buffered. Piped to a file or
 * captured by CI — which is how these scripts actually run — a buffered
 * `process.stdout.write` is exactly what gets dropped, so the log would lose
 * the steps that led up to the failure it was there to explain.
 *
 * `fail()` genuinely has to abort, so it cannot use `process.exitCode` the way
 * the CLI does; making the writes synchronous is what closes the same hole.
 */
export function log(message: string): void {
  writeSync(1, `${message}\n`);
}

/** A gate that passed. */
export function pass(message: string): void {
  log(`  \u2713 ${message}`);
}

/**
 * A gate that was deliberately not run.
 *
 * Always carries its reason: a check that vanishes silently is worse than one
 * that never existed, because the log still looks green.
 */
export function skip(message: string, reason: string): void {
  log(`  \u2500 SKIPPED ${message}\n      reason: ${reason}`);
}

/** Abort with a message on stderr and a non-zero exit. See `log` on why it is synchronous. */
export function fail(message: string): never {
  writeSync(2, `\u2717 ${message}\n`);
  process.exit(1);
}
