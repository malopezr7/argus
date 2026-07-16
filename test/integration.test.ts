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

function runFixture(file: string): number {
  try {
    execFileSync('pnpm', ['exec', 'tsx', 'scripts/run-phase1.ts', file], {
      cwd: REPO,
      stdio: 'ignore',
    });
    return 0;
  } catch (e) {
    const status = (e as { status?: number }).status;
    return typeof status === 'number' ? status : 1;
  }
}

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

describe('argus harness integration (needs .hermes/hermes)', () => {
  gated(
    'passing sample -> exit 0',
    () => {
      expect(runFixture('examples/math.test.ts')).toBe(0);
    },
    20_000,
  );

  gated(
    'failing test -> exit 1',
    () => {
      expect(runFixture('examples/robustness.test.ts')).toBe(1);
    },
    20_000,
  );

  gated(
    'nonce forge attempt -> infrastructure-failure exit 2',
    () => {
      expect(runFixture('examples/forge.test.ts')).toBe(2);
    },
    20_000,
  );

  gated(
    'print() hijack cannot force a false green',
    () => {
      expect(runFixture('examples/print-hijack.test.ts')).not.toBe(0);
    },
    20_000,
  );

  gated(
    'JSON.stringify hijack cannot force a false green',
    () => {
      expect(runFixture('examples/json-hijack.test.ts')).not.toBe(0);
    },
    20_000,
  );

  gated(
    'Object.prototype.toJSON pollution cannot force a false green',
    () => {
      expect(runFixture('examples/tojson-hijack.test.ts')).not.toBe(0);
    },
    20_000,
  );

  gated(
    'Array.prototype[Symbol.iterator] pollution cannot force a false green',
    () => {
      expect(runFixture('examples/iterator-hijack.test.ts')).not.toBe(0);
    },
    20_000,
  );

  gated(
    'Array.prototype.push pollution cannot force a false green',
    () => {
      expect(runFixture('examples/push-hijack.test.ts')).not.toBe(0);
    },
    20_000,
  );
});

// ---------------------------------------------------------------------------
// Phase 3 (item 3): Matcher integration tests (task 5.10)
// ---------------------------------------------------------------------------

describe('argus matchers integration (needs .hermes/hermes)', () => {
  gated(
    'matchers.test.ts — all matcher assertions pass on real Hermes → exit 0',
    () => {
      expect(runArgus(['examples/matchers.test.ts'])).toBe(0);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Phase 3: Concurrency tests (tasks 5.1b, 5.5, 2.2b integration)
// ---------------------------------------------------------------------------

describe('argus CLI — concurrency (needs .hermes/hermes)', () => {
  // Task 2.2b integration — exit 2 on invalid --concurrency
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

  // Task 5.1b — -c 1 vs -c N byte-identity for stdout AND stderr (normalized for timing)
  gated(
    '5.1b: -c 1 and -c 4 produce identical stdout+stderr (after timing normalization)',
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
    '5.1b: -c 1 and -c 2 on multiple files produce identical stdout+stderr',
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

  // Task 5.5 — -c 2 with mixed pass/fail/infra → discovery-ordered output + worst-case exit
  gated(
    '5.5: -c 2 mixed pass/fail/infra → exit 2 (infra worst-case)',
    () => {
      // examples/**/*.test.ts includes forge.test.ts (infra-failure) → worst-case = 2
      const result = runArgusCapture(['-c', '2', 'examples/**/*.test.ts']);
      expect(result.status).toBe(2);
    },
    90_000,
  );

  gated(
    '5.5: -c 2 output is in discovery order (math before robustness)',
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
