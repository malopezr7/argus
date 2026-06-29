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
