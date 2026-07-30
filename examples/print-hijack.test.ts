/**
 * Adversarial: a user test replaces `globalThis.print` to STEAL the per-run
 * nonce out of the result frame and emit a passing frame in its place.
 *
 * This is the attack the framework's captured primordial exists to stop. If
 * `safePrint = print` were ever taken lazily instead of at module-eval — before
 * any user code runs — the framework's emission would pass through the wrapper
 * below, hand it the real nonce, and this file would report a FALSE GREEN.
 *
 * The wrapper therefore does two things the previous version did not:
 *
 *  1. It PARSES the intercepted line for the nonce instead of forging with a
 *     hardcoded one. A hardcoded nonce never matches, so the old fixture stayed
 *     "green" even with primordial capture completely removed — it could not
 *     detect the single regression it exists to catch.
 *  2. It SUPPRESSES the honest frame rather than forwarding it. Forwarding left
 *     the true result on stdout, so the host reported the real failure no
 *     matter what the attacker did.
 *
 * With capture intact the framework never calls this wrapper, the honest frame
 * is emitted, and the failing test below is reported as failed.
 * Expected: exit 1, reported as 0 passed / 1 failed.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };
declare const globalThis: { print: (s: string) => void };
declare const console: { log: (...args: unknown[]) => void };

/** MUST stay in sync with ARGUS_RESULT_PREFIX in @arguslab/core. */
const RESULT_PREFIX = '__ARGUS_RESULT__:';

/** A well-formed envelope claiming everything passed. */
const FORGED_ENVELOPE =
  '{"v":1,"ok":true,"result":{"suites":[],"totals":{"passed":1,"failed":0,"skipped":0,"todo":0,"total":1},"durationMs":0}}';

const realPrint = globalThis.print;

globalThis.print = (s: string): void => {
  const line = typeof s === 'string' ? s : `${s as never}`;

  if (line.indexOf(RESULT_PREFIX) === 0) {
    // The frame is `__ARGUS_RESULT__:<nonce>:<json>`. Everything between the
    // prefix and the next ':' is the secret the host validates against.
    const rest = line.slice(RESULT_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep > 0) {
      const stolenNonce = rest.slice(0, sep);
      // Emit a passing frame under the STOLEN nonce and drop the honest one.
      // If this ever reaches stdout, the host accepts it: the nonce is real.
      realPrint(RESULT_PREFIX + stolenNonce + ':' + FORGED_ENVELOPE);
      return;
    }
  }

  realPrint(line);
};

describe('print-hijack', () => {
  test('this test FAILS and must be reported as failed', () => {
    // Routes through the wrapper above (the console polyfill resolves `print`
    // at call time), so the interception is demonstrably live even when the
    // framework's own emission correctly bypasses it.
    console.log('trigger the hijacked print');
    expect(1).toBe(2);
  });
});
