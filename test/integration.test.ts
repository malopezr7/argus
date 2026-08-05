import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * End-to-end harness regression: runs Argus example fixtures on the real Hermes
 * binary and asserts the process exit code. These lock in the security
 * guarantees (no forged false-green via nonce or primordial hijack).
 *
 * Gated on the presence of the local Hermes binary (.hermes/hermes), which is
 * gitignored — skipped automatically in environments without it.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HERMES = resolve(REPO, '.hermes/hermes');
const gated = existsSync(HERMES) ? it : it.skip;

function runArgus(args: string[]): number {
  try {
    execFileSync('pnpm', ['argus', ...args], {
      cwd: REPO,
      stdio: 'ignore',
    });
    return 0;
  } catch (e) {
    const status = (e as { status?: number }).status;
    return typeof status === 'number' ? status : 1;
  }
}

/** Run argus and capture both stdout and stderr. Returns exit code, stdout, stderr. */
function runArgusCapture(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('pnpm', ['argus', ...args], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Normalize volatile parts of CLI output so byte-identity can be asserted across runs.
 * Removes:
 *  - "NNN ms in Hermes" timing values
 *  - pnpm command echo lines (e.g. "$ tsx packages/cli/src/cli.ts -c 1 ...")
 *  - volatile temp directory paths in stack traces (e.g. /tmp/argus-XXXXX/run.argus-bundle.js)
 */
function normalize(s: string): string {
  return s
    .replace(/\d+ ms in Hermes/g, '<DURATION> ms in Hermes')
    .replace(/^\$.+\n?/gm, '') // strip pnpm command-echo lines starting with $
    .replace(/\/[^\s"']*argus-[A-Za-z0-9]+\/[^\s"')]+/g, '<TMPFILE>'); // strip volatile tmp paths
}

describe('argus CLI integration (needs .hermes/hermes)', () => {
  gated(
    'single passing file -> exit 0',
    () => {
      expect(runArgus(['examples/math.test.ts'])).toBe(0);
    },
    30_000,
  );

  gated(
    'multi-file glob with mixed results -> exit 1 (failure wins over pass)',
    () => {
      // robustness.test.ts has a failing test, math.test.ts passes → worst-case = 1
      expect(runArgus(['examples/math.test.ts', 'examples/robustness.test.ts'])).toBe(1);
    },
    30_000,
  );

  gated(
    'multi-file glob including infra-failure -> exit 2 (infra wins over test-failure)',
    () => {
      // forge.test.ts causes an infra-failure (Hermes exits 1, no valid frame)
      // → worst-case code across all files = 2
      expect(runArgus(['examples/**/*.test.ts'])).toBe(2);
    },
    60_000,
  );

  gated(
    'zero-match pattern -> exit 2 (discover infrastructure-failure)',
    () => {
      expect(runArgus(['no-match-pattern/**/*.test.ts'])).toBe(2);
    },
    15_000,
  );

  gated(
    'component query failure -> exit 1',
    () => {
      expect(runArgus(['examples/component-query-failing.test.tsx'])).toBe(1);
    },
    30_000,
  );

  gated(
    'TSX glob discovers component fixtures and preserves test-failure exit 1',
    () => {
      const result = runArgusCapture(['examples/**/*.test.tsx']);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('component-query-failing.test.tsx');
      expect(result.stdout).toContain('component-api.test.tsx');
    },
    60_000,
  );
});

/**
 * What a REJECTED forgery looks like, as opposed to a run that never happened.
 *
 * `expect(status).not.toBe(0)` cannot tell those apart, and that is not a
 * theoretical gap: with ARGUS_HERMES pointing at a path that does not exist,
 * the CLI exits 2 out of provisioning, no fixture is bundled, no VM is spawned
 * — and every one of these assertions still passed. They attested to "something
 * failed", which is the one thing a security fixture must never settle for.
 *
 * The evidence that the defence actually held is that the honest result
 * SURVIVED the attack, and every piece of it is already on the wire:
 *
 *   exit 1                  a result was produced. Exit 1 means "tests failed",
 *                           which is only reachable AFTER an envelope was
 *                           parsed and shape-validated. Infrastructure and
 *                           protocol failures are exit 2 and cannot satisfy it.
 *   no INFRASTRUCTURE       rules out a missing binary, a failed provision and
 *                           a VM that died before emitting.
 *   no PROTOCOL FAILURE     rules out the envelope being discarded for a
 *                           missing, duplicated or malformed frame — which is
 *                           how a SUCCESSFUL theft of the nonce would surface
 *                           if the attacker emitted a second valid frame.
 *   the honest totals       the fixture's real, failing test is reported as
 *                           failed, and the forged totals every one of these
 *                           fixtures asks for (1 passed / 0 failed) were NOT
 *                           adopted.
 *
 * Together those pin the outcome to exactly one story: the VM ran, the
 * framework emitted, the forgery was ignored, and the truth was reported.
 */
function expectForgeryRejected(fixture: string, suiteName: string): void {
  const r = runArgusCapture([`examples/${fixture}.test.ts`]);

  expect(r.stderr).not.toContain('INFRASTRUCTURE FAILURE');
  expect(r.stderr).not.toContain('PROTOCOL FAILURE');
  expect(r.stderr).not.toContain('TIMEOUT');
  expect(r.status).toBe(1);

  // The suite ran and is named in the report — the file was not skipped.
  expect(r.stdout).toContain(suiteName);
  // The honest outcome, verbatim. The forged envelope in every one of these
  // fixtures claims 1 passed / 0 failed; adopting it would change this line.
  expect(r.stdout).toContain('0 passed, 1 failed, 0 todo, 1 total');
  expect(r.stdout).toContain(`✗ ${fixture}.test.ts (1 of 1 failed)`);
}

/**
 * Result-channel integrity, asserted through the SHIPPED entry point.
 *
 * These lock in that user code cannot forge a false green — not by writing a
 * result frame to stdout, not by replacing `print`, `JSON.stringify`,
 * `Object.prototype.toJSON`, `Array.prototype.push` or the array iterator.
 *
 * They drive `pnpm argus`, the same command a user runs. They previously drove
 * a parallel harness script that duplicated the CLI's wiring, which meant this
 * block could stay green while the pipeline users actually execute regressed.
 */
describe('argus CLI — result-channel integrity (needs .hermes/hermes)', () => {
  gated(
    'a genuinely failing test is reported as a test failure -> exit 1',
    () => {
      expect(runArgus(['examples/robustness.test.ts'])).toBe(1);
    },
    30_000,
  );

  /**
   * The forge fixture is the one adversarial case that must NOT produce a
   * result, so it gets its own assertion rather than `expectForgeryRejected`.
   *
   * It proves two things at once, and the exit code alone proves neither:
   *
   *  1. User code cannot obtain the per-run nonce. The fixture actively hunts
   *     for it — named globals, every own key of globalThis, and the source of
   *     every reachable function via Function.prototype.toString — and prints
   *     a loud marker if it ever finds one. That marker must be absent.
   *  2. A frame printed BEFORE a later top-level crash is rejected. That is a
   *     documented, separate defence in parseHermesOutput (a nonzero exit
   *     discards the run even when a well-formed frame is present), and it is
   *     what makes exit 2 the correct contract for this fixture.
   *
   * The previous version proved neither: it referenced `__ARGUS_NONCE__`, a
   * global NOTHING defines, so Hermes threw a ReferenceError while evaluating
   * the argument to console.log. No frame was ever printed and the trailing
   * throw never ran — exit 2 came from a typo-shaped crash. Asserting the
   * absence of `ReferenceError` and the presence of the deliberate throw is
   * what keeps that from silently returning.
   */
  gated(
    'nonce stays unreachable, and a frame before a top-level crash is rejected -> exit 2',
    () => {
      const r = runArgusCapture(['examples/forge.test.ts']);

      expect(r.status).toBe(2);
      // The VM ran and died on the fixture's OWN throw, after emitting. Stage
      // `engine` (not `provision`/`bundle`) is what rules out a missing binary.
      expect(r.stderr).toContain('INFRASTRUCTURE FAILURE [engine]');
      expect(r.stderr).toContain('hermes exited exitCode=1');
      expect(r.stderr).toContain('boom after forging');
      // The old failure mode: dying on an undefined global before forging.
      expect(r.stderr).not.toContain('ReferenceError');
      // The nonce hunt came up empty. If it ever does not, this is the alarm.
      expect(r.stdout + r.stderr).not.toContain('ARGUS_NONCE_LEAKED');
    },
    30_000,
  );

  gated(
    'print() hijack cannot steal the nonce or force a false green',
    () => {
      expectForgeryRejected('print-hijack', 'print-hijack');
    },
    30_000,
  );

  gated(
    'JSON.stringify hijack cannot force a false green',
    () => {
      expectForgeryRejected('json-hijack', 'json-hijack');
    },
    30_000,
  );

  gated(
    'Object.prototype.toJSON pollution cannot force a false green',
    () => {
      expectForgeryRejected('tojson-hijack', 'tojson-hijack');
    },
    30_000,
  );

  gated(
    'Array.prototype[Symbol.iterator] pollution cannot force a false green',
    () => {
      expectForgeryRejected('iterator-hijack', 'iterator-hijack');
    },
    30_000,
  );

  gated(
    'Array.prototype.push pollution cannot force a false green',
    () => {
      expectForgeryRejected('push-hijack', 'push-hijack');
    },
    30_000,
  );

  gated(
    'MessageChannel replacement cannot suppress the result frame',
    () => {
      const r = runArgusCapture(['examples/message-channel-hijack.test.tsx']);

      expect(r.status).toBe(1);
      expect(r.stderr).not.toContain('INFRASTRUCTURE FAILURE');
      expect(r.stderr).not.toContain('PROTOCOL FAILURE');
      expect(r.stderr).not.toContain('TIMEOUT');
      expect(r.stdout).toContain('MessageChannel hijack');
      expect(r.stdout).toContain('2 passed, 1 failed, 0 todo, 3 total');
    },
    30_000,
  );
});

/**
 * Regression: a class in the user's own test file.
 *
 * Legacy Hermes cannot parse `class` in any form, and the bundler used to be
 * handed a hardcoded es2020 target regardless of the engine that had actually
 * been resolved — so `class Punto {}` in a `.test.ts` reached the VM verbatim
 * and killed the whole file with an infrastructure failure before any test ran.
 */
describe('argus CLI — class syntax on the resolved engine (needs .hermes/hermes)', () => {
  gated(
    "a class in the user's own test file runs -> exit 0",
    () => {
      expect(runArgus(['examples/class-syntax.test.ts'])).toBe(0);
    },
    30_000,
  );

  gated(
    'a class with a semicolon inside its leading comment runs -> exit 0',
    () => {
      expect(runArgus(['examples/class-comment-semicolon.test.tsx'])).toBe(0);
    },
    30_000,
  );

  gated(
    'every class form reports as a passing test, not an engine failure',
    () => {
      const result = runArgusCapture(['examples/class-syntax.test.ts']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('9 passed');
      // The old failure mode. It is an INFRASTRUCTURE failure, so asserting the
      // exit code alone would not distinguish it from an ordinary test failure.
      expect(result.stderr).not.toContain('INFRASTRUCTURE FAILURE');
    },
    30_000,
  );
});

describe('argus CLI — MessageChannel fidelity (needs .hermes/hermes)', () => {
  gated(
    'a plain suite sees no component-only MessageChannel polyfill',
    () => {
      expect(runArgus(['examples/message-channel-fidelity.test.tsx'])).toBe(0);
    },
    30_000,
  );
});

/**
 * Regression: the result channel and the C0 range.
 *
 * The serializer escaped only `"`, `\` and the five control characters with
 * short JSON forms. Any other C0 character went out raw, the envelope would not
 * parse, and every result in the file was discarded — so a test that merely
 * COMPARED strings containing an ESC took down its whole file.
 */
describe('argus CLI — control characters in the result channel (needs .hermes/hermes)', () => {
  gated(
    'the whole C0 range survives the result channel -> exit 0',
    () => {
      const result = runArgusCapture(['examples/control-chars.test.ts']);
      expect(result.status).toBe(0);
      // The old failure mode was a protocol failure for the entire file.
      expect(result.stdout).not.toContain('PROTOCOL FAILURE');
    },
    30_000,
  );

  gated(
    'every C0 character comes back byte-identical, not merely parseable',
    () => {
      const result = runArgusCapture(['examples/control-chars.test.ts']);
      // Each name was built inside Hermes, hand-serialized, framed on one line,
      // JSON.parsed on the host and rendered. Matching the exact bytes here is
      // what proves the round trip, rather than just that the envelope parsed.
      for (let code = 0; code < 0x20; code++) {
        expect(result.stdout).toContain(`C0 ${code} [ ${String.fromCharCode(code)} ] round-trips`);
      }
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Matcher integration tests
// ---------------------------------------------------------------------------

describe('argus matchers integration (needs .hermes/hermes)', () => {
  gated(
    'matchers.test.ts — all matcher assertions pass on real Hermes → exit 0',
    () => {
      expect(runArgus(['examples/matchers.test.ts'])).toBe(0);
    },
    30_000,
  );

  gated(
    'committed snapshot fixture passes without -u',
    () => {
      expect(runArgus(['examples/snapshots.test.ts'])).toBe(0);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Concurrency tests
// ---------------------------------------------------------------------------

describe('argus CLI — concurrency (needs .hermes/hermes)', () => {
  // exit 2 on invalid --concurrency
  it('-c 0 → exit 2 (usage error, no hermes binary needed)', () => {
    // This exits before even looking for hermes, so no gating needed
    const result = runArgusCapture(['-c', '0', 'examples/math.test.ts']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/concurrency/i);
  }, 10_000);

  it('-c foo → exit 2 (usage error)', () => {
    const result = runArgusCapture(['-c', 'foo', 'examples/math.test.ts']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/concurrency/i);
  }, 10_000);

  // -c 1 vs -c N byte-identity for stdout AND stderr (normalized for timing)
  gated(
    '-c 1 and -c 4 produce identical stdout+stderr (after timing normalization)',
    () => {
      const c1 = runArgusCapture(['-c', '1', 'examples/math.test.ts']);
      const cN = runArgusCapture(['-c', '4', 'examples/math.test.ts']);

      expect(normalize(c1.stdout)).toBe(normalize(cN.stdout));
      expect(normalize(c1.stderr)).toBe(normalize(cN.stderr));
      expect(c1.status).toBe(cN.status);
    },
    60_000,
  );

  gated(
    '-c 1 and -c 2 on multiple files produce identical stdout+stderr',
    () => {
      const files = ['examples/math.test.ts', 'examples/robustness.test.ts'];
      const c1 = runArgusCapture(['-c', '1', ...files]);
      const cN = runArgusCapture(['-c', '2', ...files]);

      expect(normalize(c1.stdout)).toBe(normalize(cN.stdout));
      expect(normalize(c1.stderr)).toBe(normalize(cN.stderr));
      expect(c1.status).toBe(cN.status);
    },
    60_000,
  );

  // -c 2 with mixed pass/fail/infra → discovery-ordered output + worst-case exit
  gated(
    '-c 2 mixed pass/fail/infra → exit 2 (infra worst-case)',
    () => {
      // examples/**/*.test.ts includes forge.test.ts (infra-failure) → worst-case = 2
      const result = runArgusCapture(['-c', '2', 'examples/**/*.test.ts']);
      expect(result.status).toBe(2);
    },
    90_000,
  );

  gated(
    '-c 2 output is in discovery order (math before robustness)',
    () => {
      const result = runArgusCapture([
        '-c',
        '2',
        'examples/math.test.ts',
        'examples/robustness.test.ts',
      ]);
      const combined = result.stdout + result.stderr;
      const mathIdx = combined.indexOf('math');
      const robIdx = combined.indexOf('robustness');
      // math.test.ts is discovered first → its output appears first in combined output
      expect(mathIdx).toBeGreaterThanOrEqual(0);
      expect(robIdx).toBeGreaterThanOrEqual(0);
      expect(mathIdx).toBeLessThan(robIdx);
    },
    60_000,
  );
});
