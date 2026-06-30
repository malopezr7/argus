/**
 * @argus/framework — expect() matchers
 *
 * BOUNDARY NOTE (read before editing):
 *
 * This module runs IN-REALM — inside the same Hermes VM as user test code.
 * It is therefore OUTSIDE the result-channel integrity boundary.  The channel
 * is protected by captured primordials + the hand-written serializer in
 * index.ts; those must never be modified.  Here we may use ordinary,
 * potentially-pollutable language constructs (Object.keys, instanceof,
 * RegExp.prototype.test, constructor identity) because:
 *
 *   - A matcher fooled by pollution can at worst mis-decide ONE assertion.
 *   - It cannot forge the result envelope (serializer uses captured primordials
 *     + own-property index access only; serStr escapes all thrown strings).
 *   - It cannot skip registered tests (registry is walked by index loops in
 *     index.ts).
 *
 * KNOWN LIMITATIONS (documented, not bugs):
 *
 *   Map / Set structural equality — NOT supported.  Calling toEqual/toStrictEqual
 *   on a Map or Set throws a loud error with guidance.  This prevents the silent
 *   false-pass that occurs when deepEqual falls through to the plain-object
 *   branch (Map has no enumerable own keys, so any two Maps would compare equal).
 *   Use Array.from(map.entries()) or assert on specific entries instead.
 *
 *   Constructor identity (toStrictEqual type tag) — uses a.constructor === b.constructor.
 *   This is pollutable: an adversarial test can set obj.constructor = SomethingElse
 *   to defeat the check.  Accepted trade-off: smaller global surface than
 *   Object.prototype.toString (which reads the pollutable Symbol.toStringTag),
 *   and still correctly distinguishes class instances with identical fields.
 *
 * HERMES 0.17 ENVELOPE RULES (enforced in deepEqual + show):
 *   - No async arrows / generators / await
 *   - No WeakRef / WeakMap / WeakSet (cycle tracking uses parallel index arrays)
 *   - No for..of / spread in deepEqual or show (immune to iterator pollution)
 *   - No Array.prototype methods in deepEqual or show (use index loops + .length)
 *   - No Intl APIs
 *   Allowed: Object.is, Object.keys, Array.isArray, instanceof, Object.prototype.
 *            hasOwnProperty.call, Object.getOwnPropertyDescriptor, String/Number ops,
 *            RegExp.prototype.test, try/catch, constructor reads.
 */

import { deepEqual, getByPath, matchObject, sameValueZero } from './deep-equal.js';
import { show } from './show.js';

export { show } from './show.js';

// ---------------------------------------------------------------------------
// Matchers interface
// ---------------------------------------------------------------------------

export interface Matchers {
  readonly not: Matchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeNaN(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toBeCloseTo(expected: number, numDigits?: number): void;
  toMatch(pattern: string | RegExp): void;
  toContain(item: unknown): void;
  toContainEqual(item: unknown): void;
  toHaveLength(n: number): void;
  toHaveProperty(keyPath: string | Array<string | number>, value?: unknown): void;
  toMatchObject(subset: object): void;
  toThrow(expected?: unknown): void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function expect(actual: unknown): Matchers {
  return makeMatchers(actual, false);
}

// ---------------------------------------------------------------------------
// Core factory
// ---------------------------------------------------------------------------

/** R9: makeAssert takes only negated (no actual param). */
function makeAssert(negated: boolean) {
  return function assert(pass: boolean, buildMsg: () => string, buildNotMsg: () => string): void {
    const effective = negated ? !pass : pass;
    if (!effective) {
      throw new Error(negated ? buildNotMsg() : buildMsg());
    }
  };
}

function makeMatchers(actual: unknown, negated: boolean): Matchers {
  const assert = makeAssert(negated);

  const m: Matchers = {
    get not(): Matchers {
      return makeMatchers(actual, true);
    },

    // --- Equality ---

    toBe(expected: unknown): void {
      // AC-07
      const pass = Object.is(actual, expected);
      assert(
        pass,
        () => `expect(${show(actual)}).toBe(${show(expected)})`,
        () => `expect(${show(actual)}).not.toBe(${show(expected)})`,
      );
    },

    toEqual(expected: unknown): void {
      // AC-01, AC-02, AC-06
      const pass = deepEqual(actual, expected, false);
      assert(
        pass,
        () => `expect(${show(actual)}).toEqual(${show(expected)})`,
        () => `expect(${show(actual)}).not.toEqual(${show(expected)})`,
      );
    },

    toStrictEqual(expected: unknown): void {
      // AC-03, AC-04, AC-05
      const pass = deepEqual(actual, expected, true);
      assert(
        pass,
        () => `expect(${show(actual)}).toStrictEqual(${show(expected)})`,
        () => `expect(${show(actual)}).not.toStrictEqual(${show(expected)})`,
      );
    },

    // --- Truthiness ---

    toBeTruthy(): void {
      // AC-08
      const pass = Boolean(actual);
      assert(
        pass,
        () => `expect(${show(actual)}).toBeTruthy()`,
        () => `expect(${show(actual)}).not.toBeTruthy()`,
      );
    },

    toBeFalsy(): void {
      // AC-08
      const pass = !actual;
      assert(
        pass,
        () => `expect(${show(actual)}).toBeFalsy()`,
        () => `expect(${show(actual)}).not.toBeFalsy()`,
      );
    },

    toBeNull(): void {
      const pass = actual === null;
      assert(
        pass,
        () => `expect(${show(actual)}).toBeNull()`,
        () => `expect(${show(actual)}).not.toBeNull()`,
      );
    },

    toBeUndefined(): void {
      const pass = actual === undefined;
      assert(
        pass,
        () => `expect(${show(actual)}).toBeUndefined()`,
        () => `expect(${show(actual)}).not.toBeUndefined()`,
      );
    },

    toBeDefined(): void {
      const pass = actual !== undefined;
      assert(
        pass,
        () => `expect(${show(actual)}).toBeDefined()`,
        () => `expect(${show(actual)}).not.toBeDefined()`,
      );
    },

    toBeNaN(): void {
      const pass = Object.is(actual, Number.NaN);
      assert(
        pass,
        () => `expect(${show(actual)}).toBeNaN()`,
        () => `expect(${show(actual)}).not.toBeNaN()`,
      );
    },

    // --- Numeric ---

    toBeGreaterThan(n: number): void {
      // AC-09
      const pass = typeof actual === 'number' && actual > n;
      assert(
        pass,
        () => `expect(${show(actual)}).toBeGreaterThan(${show(n)})`,
        () => `expect(${show(actual)}).not.toBeGreaterThan(${show(n)})`,
      );
    },

    toBeGreaterThanOrEqual(n: number): void {
      const pass = typeof actual === 'number' && actual >= n;
      assert(
        pass,
        () => `expect(${show(actual)}).toBeGreaterThanOrEqual(${show(n)})`,
        () => `expect(${show(actual)}).not.toBeGreaterThanOrEqual(${show(n)})`,
      );
    },

    toBeLessThan(n: number): void {
      const pass = typeof actual === 'number' && actual < n;
      assert(
        pass,
        () => `expect(${show(actual)}).toBeLessThan(${show(n)})`,
        () => `expect(${show(actual)}).not.toBeLessThan(${show(n)})`,
      );
    },

    toBeLessThanOrEqual(n: number): void {
      const pass = typeof actual === 'number' && actual <= n;
      assert(
        pass,
        () => `expect(${show(actual)}).toBeLessThanOrEqual(${show(n)})`,
        () => `expect(${show(actual)}).not.toBeLessThanOrEqual(${show(n)})`,
      );
    },

    toBeCloseTo(expected: number, numDigits?: number): void {
      // AC-10, AC-11
      const digits = numDigits === undefined ? 2 : numDigits;
      const tolerance = 10 ** -digits / 2;
      const pass = typeof actual === 'number' && Math.abs(actual - expected) < tolerance;
      assert(
        pass,
        () =>
          `expect(${show(actual)}).toBeCloseTo(${show(expected)}, ${show(digits)}) — diff ${Math.abs((actual as number) - expected)}`,
        () => `expect(${show(actual)}).not.toBeCloseTo(${show(expected)}, ${show(digits)})`,
      );
    },

    // --- String / Collection ---

    toMatch(pattern: string | RegExp): void {
      // AC-12
      let pass: boolean;
      if (typeof pattern === 'string') {
        pass = typeof actual === 'string' && actual.indexOf(pattern) !== -1;
      } else {
        pass = typeof actual === 'string' && RegExp.prototype.test.call(pattern, actual);
      }
      assert(
        pass,
        () => `expect(${show(actual)}).toMatch(${show(pattern)})`,
        () => `expect(${show(actual)}).not.toMatch(${show(pattern)})`,
      );
    },

    toContain(item: unknown): void {
      // AC-13, AC-37 (R7 — SameValueZero, +0 ≡ -0, NaN ≡ NaN)
      let pass: boolean;
      if (typeof actual === 'string') {
        pass = typeof item === 'string' && actual.indexOf(item) !== -1;
      } else if (Array.isArray(actual)) {
        pass = false;
        const arr = actual as unknown[];
        for (let i = 0; i < arr.length; i++) {
          if (sameValueZero(arr[i], item)) {
            pass = true;
            break;
          }
        }
      } else {
        pass = false;
      }
      assert(
        pass,
        () => `expect(${show(actual)}).toContain(${show(item)})`,
        () => `expect(${show(actual)}).not.toContain(${show(item)})`,
      );
    },

    toContainEqual(item: unknown): void {
      // AC-14
      let pass = false;
      if (Array.isArray(actual)) {
        const arr = actual as unknown[];
        for (let i = 0; i < arr.length; i++) {
          if (deepEqual(arr[i], item, false)) {
            pass = true;
            break;
          }
        }
      }
      assert(
        pass,
        () => `expect(${show(actual)}).toContainEqual(${show(item)})`,
        () => `expect(${show(actual)}).not.toContainEqual(${show(item)})`,
      );
    },

    toHaveLength(n: number): void {
      // AC-15
      const len = (actual as { length?: unknown }).length;
      const pass = len === n;
      assert(
        pass,
        () => `expect(${show(actual)}).toHaveLength(${show(n)}) — actual length ${show(len)}`,
        () => `expect(${show(actual)}).not.toHaveLength(${show(n)})`,
      );
    },

    // --- Object (R6: arguments.length distinguishes omitted vs explicit undefined) ---

    toHaveProperty(keyPath: string | Array<string | number>, value?: unknown): void {
      // AC-16, AC-17, AC-38
      // biome-ignore lint: arguments.length needed for R6 (detect omitted vs explicit undefined)
      const checkValue = arguments.length >= 2;
      const resolved = getByPath(actual, keyPath);
      let pass: boolean;
      if (!resolved.found) {
        pass = false;
      } else if (checkValue) {
        pass = deepEqual(resolved.value, value, false);
      } else {
        pass = true;
      }
      assert(
        pass,
        () =>
          `expect(${show(actual)}).toHaveProperty(${show(keyPath)}${checkValue ? `, ${show(value)}` : ''})`,
        () =>
          `expect(${show(actual)}).not.toHaveProperty(${show(keyPath)}${checkValue ? `, ${show(value)}` : ''})`,
      );
    },

    toMatchObject(subset: object): void {
      // AC-18
      const pass = matchObject(actual, subset);
      assert(
        pass,
        () => `expect(${show(actual)}).toMatchObject(${show(subset)})`,
        () => `expect(${show(actual)}).not.toMatchObject(${show(subset)})`,
      );
    },

    // --- Error ---

    toThrow(expected?: unknown): void {
      // AC-19..22, AC-39 (ADR-6, R8)
      if (typeof actual !== 'function') {
        throw new Error(`expect(received).toThrow() requires a function; received ${show(actual)}`);
      }
      let threw = false;
      let thrown: unknown;
      try {
        (actual as () => unknown)();
      } catch (e) {
        threw = true;
        thrown = e;
      }

      // biome-ignore lint: arguments.length for no-arg detection (omitted vs explicit undefined)
      const hasExpected = arguments.length >= 1;
      const pass = threw && (!hasExpected || matchesThrow(thrown, expected));

      assert(
        pass,
        () =>
          threw
            ? `expect(fn).toThrow(${show(expected)}) — threw ${show(thrownMessage(thrown))}`
            : `expect(fn).toThrow(${show(expected)}) — function did not throw`,
        () =>
          `expect(fn).not.toThrow(${show(expected)}) — but it threw ${show(thrownMessage(thrown))}`,
      );
    },
  };

  return m;
}

// ---------------------------------------------------------------------------
// toThrow helpers (ADR-6, R8)
// ---------------------------------------------------------------------------

function thrownMessage(thrown: unknown): string {
  if (
    thrown !== null &&
    typeof thrown === 'object' &&
    typeof (thrown as { message?: unknown }).message === 'string'
  ) {
    return (thrown as { message: string }).message;
  }
  return String(thrown);
}

function matchesThrow(thrown: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (typeof expected === 'string') {
    return thrownMessage(thrown).indexOf(expected) !== -1;
  }
  if (expected instanceof RegExp) {
    return RegExp.prototype.test.call(expected, thrownMessage(thrown));
  }
  if (typeof expected === 'function') {
    return thrown instanceof (expected as new (...args: unknown[]) => unknown);
  }
  if (expected instanceof Error) {
    // R8 / AC-39: Error instance — match on message substring
    return thrownMessage(thrown).indexOf(expected.message) !== -1;
  }
  throw new Error(
    `toThrow expected a string, RegExp, Error class, or Error instance; received ${show(expected)}`,
  );
}
