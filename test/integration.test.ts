import { execFileSync } from 'node:child_process';
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
