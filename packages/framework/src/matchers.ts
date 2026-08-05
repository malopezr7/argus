/**
 * @arguslab/framework — expect() matchers
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

import { makeAsyncMatchers, matchesThrow, thrownMessage } from './async-matchers.js';
import { mixinCallMatchers } from './call-matchers.js';
import { deepEqual, getByPath, matchObject, sameValueZero } from './deep-equal.js';
import {
  type CustomMatcherFn,
  customMatchers,
  installAssertionCounting,
  setExpectedAssertions,
} from './expect-state.js';
import type { AsyncMatchers, Matchers } from './matcher-types.js';
import { show } from './show.js';
import { matchSnapshot } from './snapshot/state.js';

export { resetAssertions, verifyAssertions } from './expect-state.js';
export type { AsyncMatchers, Matchers } from './matcher-types.js';
export { show } from './show.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function expect(actual: unknown): Matchers {
  return makeMatchers(actual, false);
}

// Assertion count expectation setters
(expect as unknown as Record<string, unknown>).assertions = function assertions(n: number): void {
  setExpectedAssertions('exact', n);
};
(expect as unknown as Record<string, unknown>).hasAssertions = function hasAssertions(): void {
  setExpectedAssertions('min', 1);
};

// expect.extend — merges custom matchers
(expect as unknown as Record<string, unknown>).extend = function extend(
  table: Record<string, CustomMatcherFn>,
): void {
  const ks = Object.keys(table);
  for (let i = 0; i < ks.length; i++) {
    customMatchers[ks[i]] = table[ks[i]];
  }
};

// ---------------------------------------------------------------------------
// Core factory
// ---------------------------------------------------------------------------

/**
 * makeAssert takes only `negated` — it deliberately has no `actual` param.
 *
 * NOTE: assertion counting is NOT done here. It is done once per matcher
 * INVOCATION by the entry wrapper installed in makeMatchers, so that
 * matchers which throw a usage/guard error BEFORE reaching assert (e.g. toThrow
 * on a non-function, toEqual on a Map) still count exactly once.
 */
function makeAssert(negated: boolean) {
  return function assert(pass: boolean, buildMsg: () => string, buildNotMsg: () => string): void {
    const effective = negated ? !pass : pass;
    if (!effective) {
      throw new Error(negated ? buildNotMsg() : buildMsg());
    }
  };
}

export function makeMatchers(actual: unknown, negated: boolean): Matchers {
  const assert = makeAssert(negated);

  const m = {
    get not(): Matchers {
      return makeMatchers(actual, true);
    },

    get resolves(): AsyncMatchers {
      return makeAsyncMatchers(actual, negated, false, makeMatchers, customMatchers);
    },

    get rejects(): AsyncMatchers {
      return makeAsyncMatchers(actual, negated, true, makeMatchers, customMatchers);
    },

    // --- Equality ---

    toBe(expected: unknown): void {
      const pass = Object.is(actual, expected);
      assert(
        pass,
        () => `expect(${show(actual)}).toBe(${show(expected)})`,
        () => `expect(${show(actual)}).not.toBe(${show(expected)})`,
      );
    },

    toEqual(expected: unknown): void {
      const pass = deepEqual(actual, expected, false);
      assert(
        pass,
        () => `expect(${show(actual)}).toEqual(${show(expected)})`,
        () => `expect(${show(actual)}).not.toEqual(${show(expected)})`,
      );
    },

    toStrictEqual(expected: unknown): void {
      const pass = deepEqual(actual, expected, true);
      assert(
        pass,
        () => `expect(${show(actual)}).toStrictEqual(${show(expected)})`,
        () => `expect(${show(actual)}).not.toStrictEqual(${show(expected)})`,
      );
    },

    // --- Truthiness ---

    toBeTruthy(): void {
      const pass = Boolean(actual);
      assert(
        pass,
        () => `expect(${show(actual)}).toBeTruthy()`,
        () => `expect(${show(actual)}).not.toBeTruthy()`,
      );
    },

    toBeFalsy(): void {
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

    toMatchSnapshot(hint?: string): void {
      matchSnapshot(actual, hint, negated);
    },

    toContain(item: unknown): void {
      // Array membership compares with SameValueZero: +0 ≡ -0 and NaN ≡ NaN.
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
      const len = (actual as { length?: unknown }).length;
      const pass = len === n;
      assert(
        pass,
        () => `expect(${show(actual)}).toHaveLength(${show(n)}) — actual length ${show(len)}`,
        () => `expect(${show(actual)}).not.toHaveLength(${show(n)})`,
      );
    },

    // --- Object (arguments.length distinguishes omitted vs explicit undefined) ---

    toHaveProperty(keyPath: string | Array<string | number>, value?: unknown): void {
      // biome-ignore lint: arguments.length needed to detect omitted vs explicit undefined
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
      const pass = matchObject(actual, subset);
      assert(
        pass,
        () => `expect(${show(actual)}).toMatchObject(${show(subset)})`,
        () => `expect(${show(actual)}).not.toMatchObject(${show(subset)})`,
      );
    },

    // --- Error ---

    toThrow(expected?: unknown): void {
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
  } as Matchers;

  // Install custom matchers
  const ck = Object.keys(customMatchers);
  for (let i = 0; i < ck.length; i++) {
    const name = ck[i];
    const fn = customMatchers[name];
    (m as Record<string, unknown>)[name] = function customMatcher(): void {
      // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17; arguments is intentional
      const args = arguments;
      const ctx = {
        isNot: negated,
        equals: function equals(a: unknown, b: unknown): boolean {
          return deepEqual(a, b, false);
        },
      };
      const r = fn.apply(
        ctx,
        [actual].concat(Array.prototype.slice.call(args)) as Parameters<typeof fn>,
      );
      const pass = r.pass;
      const msg =
        typeof r.message === 'function'
          ? r.message
          : function msgFn(): string {
              return String(r.message);
            };
      assert(pass, msg, msg);
    };
  }

  mixinCallMatchers(m as unknown as Record<string, unknown>, actual, negated, assert);

  // Count every matcher INVOCATION exactly once, at ENTRY — before any
  // matcher body can throw a usage/guard error. (See installAssertionCounting.)
  installAssertionCounting(m as unknown as Record<string, unknown>);

  return m;
}
