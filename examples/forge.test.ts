/**
 * Adversarial: can user code obtain the per-run nonce, and is a frame printed
 * before a later top-level crash rejected?
 *
 * The nonce is NOT a global and NOT an esbuild `define`. The bundler inlines it
 * as a literal argument at the `run("<nonce>")` call site in the virtual
 * entry's own module scope (adapter-esbuild/src/index.ts), which no user module
 * can reach lexically. This fixture attacks that claim head-on instead of
 * asserting it: it hunts the nonce through every avenue user code actually has
 * inside the VM, and if it EVER finds one it says so, loudly, on stdout.
 *
 * The previous version proved nothing. It read `__ARGUS_NONCE__` — a global
 * NOTHING in this repository defines — so Hermes threw
 * `ReferenceError: Property '__ARGUS_NONCE__' doesn't exist` while evaluating
 * the argument to console.log. No frame was printed, the trailing throw never
 * ran, and exit 2 came from a typo-shaped crash rather than a rejected forgery.
 *
 * SCOPE, stated precisely because a security fixture that overstates its reach
 * is worse than none. Everything here runs at user MODULE-EVAL time, so it sees
 * exactly what user top-level code can see: a `define` substitution, and any
 * global present once the framework has loaded. It does NOT see a value the
 * virtual entry assigns between its imports and `run()` — ESM import hoisting
 * puts every such statement AFTER this file has already been evaluated, which
 * is also why no entry-level assignment can leak to module-level user code in
 * the first place. A value reachable only from inside a test body is out of
 * reach here too: the throw below aborts the module, so `run()` never executes
 * and no test body ever does.
 *
 * Expected: exit 2, via INFRASTRUCTURE FAILURE [engine] on the deliberate
 * top-level throw below — with no leak marker and no ReferenceError.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };
declare const console: { log: (...args: unknown[]) => void };
declare const globalThis: Record<string, unknown>;

/**
 * Bare identifiers an esbuild `define` would substitute a literal for.
 *
 * These are declared but READ ONLY through `typeof` below. That is the whole
 * difference between this fixture and the one it replaces: the old version
 * dereferenced `__ARGUS_NONCE__` directly, and because nothing defines it,
 * Hermes threw a ReferenceError while evaluating the argument to console.log —
 * killing the file before it could forge anything.
 */
declare const __ARGUS_NONCE__: string;
declare const __ARGUS_RESULT_NONCE__: string;

/** MUST stay in sync with ARGUS_RESULT_PREFIX in @arguslab/core. */
const RESULT_PREFIX = '__ARGUS_RESULT__:';

/**
 * Printed only if the hunt succeeds. The integration test asserts its ABSENCE,
 * so the day the nonce becomes reachable this fixture stops being inert.
 */
const LEAK_MARKER = 'ARGUS_NONCE_LEAKED';

/** `randomBytes(12).toString('hex')` — 24 lowercase hex characters. */
const NONCE_RE = /[0-9a-f]{24}/;

/** Globals a nonce might plausibly have been published under. */
const SUSPECT_NAMES = [
  '__ARGUS_NONCE__',
  '__ARGUS_RESULT_NONCE__',
  '__ARGUS_RESULT__',
  'ARGUS_NONCE',
  '__ARGUS__',
  'argus',
];

/** The nonce inside `s`, if `s` carries one. */
function nonceIn(s: string): string | undefined {
  const m = NONCE_RE.exec(s);
  return m === null ? undefined : m[0];
}

/** Read `obj[key]` without letting a throwing getter abort the hunt. */
function readKey(obj: Record<string, unknown>, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

/**
 * Inspect one value: a string may BE the nonce, and a function's source may
 * CONTAIN it — `Function.prototype.toString` is the realistic way a bundled
 * literal leaks, since the whole bundle is one IIFE and the nonce is a literal
 * inside it.
 */
function inspect(value: unknown): string | undefined {
  if (typeof value === 'string') return nonceIn(value);
  if (typeof value === 'function') {
    try {
      return nonceIn((value as { toString: () => string }).toString());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Bare-identifier avenue: the one an esbuild `define` opens.
 *
 * `typeof` on an undeclared name is the only safe way to ask the question — it
 * yields 'undefined' instead of throwing when the name does not exist, while a
 * `define` substitutes its literal at exactly this spot. The old fixture's
 * docblock asserted the nonce arrived this way; it does not, and asking without
 * the guard is what made that fixture crash instead of prove anything.
 */
function huntDefines(): string | undefined {
  if (typeof __ARGUS_NONCE__ !== 'undefined') return `${__ARGUS_NONCE__}`;
  if (typeof __ARGUS_RESULT_NONCE__ !== 'undefined') return `${__ARGUS_RESULT_NONCE__}`;
  return undefined;
}

/** Every avenue user code has, in one pass. Never throws. */
function huntNonce(): string | undefined {
  try {
    // 0. Compile-time substitution (esbuild `define`).
    const defined = huntDefines();
    if (defined !== undefined) return defined;

    // 1. Named globals — including whatever `argus` turns out to hold.
    for (let i = 0; i < SUSPECT_NAMES.length; i++) {
      const found = inspect(readKey(globalThis, SUSPECT_NAMES[i]));
      if (found !== undefined) return found;
    }

    // 2. Every own key of globalThis, plus one level into object values, so
    //    installed namespaces (`argus.fn`, `console.log`, ...) are covered too.
    const keys = Object.getOwnPropertyNames(globalThis);
    for (let i = 0; i < keys.length; i++) {
      const value = readKey(globalThis, keys[i]);
      const direct = inspect(value);
      if (direct !== undefined) return direct;

      if (typeof value === 'object' && value !== null) {
        const inner = value as Record<string, unknown>;
        let innerKeys: string[];
        try {
          innerKeys = Object.getOwnPropertyNames(inner);
        } catch {
          continue;
        }
        for (let j = 0; j < innerKeys.length; j++) {
          const nested = inspect(readKey(inner, innerKeys[j]));
          if (nested !== undefined) return nested;
        }
      }
    }
  } catch {
    // A hunt that crashes must not be mistaken for a hunt that found nothing:
    // it falls through to `undefined`, and the assertions below still stand.
    return undefined;
  }
  return undefined;
}

describe('forge', () => {
  test('innocent looking', () => {
    expect(1).toBe(1);
  });
});

const stolen = huntNonce();

// Forge the frame with whatever the hunt produced, falling back to a
// well-formed guess. Either way the host must discard the run, because the
// process is about to exit nonzero — a frame emitted before a top-level crash
// is rejected EVEN IF its nonce is valid (see parseHermesOutput step 1).
const forgedNonce = stolen ?? '0123456789abcdef01234567';
console.log(
  `${RESULT_PREFIX + forgedNonce}:{"v":1,"ok":true,"result":{"suites":[],"totals":{"passed":1,"failed":0,"skipped":0,"todo":0,"total":1},"durationMs":0}}`,
);

/**
 * The verdict rides on the THROW, not on stdout.
 *
 * An infrastructure failure renders only the engine message and its `detail`,
 * which is stderr — the CLI discards the subprocess's stdout entirely (see
 * renderFileOutcome). A marker printed above could therefore never be observed
 * by the assertion that needs it, so the outcome of the hunt is encoded in the
 * uncaught error's message, which DOES reach stderr.
 *
 * Hunt empty  -> 'boom after forging'          (asserted present)
 * Hunt hit    -> 'ARGUS_NONCE_LEAKED: <nonce>' (asserted absent)
 * Either way the process exits nonzero, so the exit-2 contract is unchanged.
 */
throw new Error(
  stolen === undefined
    ? 'boom after forging'
    : `${LEAK_MARKER}: user code obtained the nonce "${stolen}"`,
);
