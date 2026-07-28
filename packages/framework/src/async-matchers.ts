/**
 * @arguslab/framework — async matchers (.resolves / .rejects)
 *
 * Extracted from matchers.ts to keep each module under ~500 LOC.
 *
 * CYCLE-FREE DESIGN: makeAsyncMatchers needs makeMatchers (from matchers.ts)
 * and matchers.ts needs makeAsyncMatchers — a classic mutual dependency.
 * We break the cycle by injecting makeMatchers as a parameter. The import
 * graph is therefore one-way:
 *
 *   matchers.ts → async-matchers.ts (import makeAsyncMatchers + toThrow helpers)
 *   async-matchers.ts → expect-state.ts (import incAssertionCount)
 *   async-matchers.ts → show.js (import show)
 *
 * makeMatchers is NEVER imported here; it arrives at call-time via parameter.
 *
 * HERMES 0.17 ENVELOPE RULES:
 *   - async via `async function` only — NEVER async arrows
 *   - No for..of / spread / Array.prototype methods / WeakRef
 *   - Index loops only
 */

import { incAssertionCount } from './expect-state.js';
import type { AsyncMatchers, Matchers } from './matcher-types.js';
import { show } from './show.js';

export type { AsyncMatchers };

// Re-export toThrow helpers so matchers.ts can import them from here.
export { matchesThrow, thrownMessage };

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

// ---------------------------------------------------------------------------
// Async matchers factory (ADR-5 / REQ-15)
//
// All methods are async function declarations — NEVER async arrows (AC-74).
// makeMatchersFn is injected to avoid a cycle with matchers.ts.
// ---------------------------------------------------------------------------

export function makeAsyncMatchers(
  actual: unknown,
  negated: boolean,
  wantReject: boolean,
  makeMatchersFn: (actual: unknown, negated: boolean) => Matchers,
  customMatchers: Record<string, unknown>,
): AsyncMatchers {
  // Settle the promise once and apply the sync matcher.
  function build(applySync: (m: Matchers) => void): Promise<void> {
    async function run(): Promise<void> {
      let settled: unknown;
      let didReject = false;
      try {
        settled = await (actual as Promise<unknown>);
      } catch (e) {
        didReject = true;
        settled = e;
      }
      if (wantReject !== didReject) {
        // D5/AC-98: count this assertion even on the wrong-settlement failure
        // path (it never reaches applySync, which would otherwise count it).
        incAssertionCount();
        throw new Error(
          wantReject
            ? `expect(promise).rejects — promise resolved with ${show(settled)}`
            : `expect(promise).resolves — promise rejected with ${show(settled)}`,
        );
      }
      // Correct settlement: applySync delegates to the sync matcher, which counts
      // the assertion exactly once (no manual count here → no double-count).
      applySync(makeMatchersFn(settled, negated));
    }
    return run();
  }

  const am: AsyncMatchers = {
    get not(): AsyncMatchers {
      return makeAsyncMatchers(actual, true, wantReject, makeMatchersFn, customMatchers);
    },

    get resolves(): AsyncMatchers {
      return makeAsyncMatchers(actual, negated, false, makeMatchersFn, customMatchers);
    },

    get rejects(): AsyncMatchers {
      return makeAsyncMatchers(actual, negated, true, makeMatchersFn, customMatchers);
    },

    toBe(expected: unknown): Promise<void> {
      return build(function applySync(m) {
        m.toBe(expected);
      });
    },
    toEqual(expected: unknown): Promise<void> {
      return build(function applySync(m) {
        m.toEqual(expected);
      });
    },
    toStrictEqual(expected: unknown): Promise<void> {
      return build(function applySync(m) {
        m.toStrictEqual(expected);
      });
    },
    toBeTruthy(): Promise<void> {
      return build(function applySync(m) {
        m.toBeTruthy();
      });
    },
    toBeFalsy(): Promise<void> {
      return build(function applySync(m) {
        m.toBeFalsy();
      });
    },
    toBeNull(): Promise<void> {
      return build(function applySync(m) {
        m.toBeNull();
      });
    },
    toBeUndefined(): Promise<void> {
      return build(function applySync(m) {
        m.toBeUndefined();
      });
    },
    toBeDefined(): Promise<void> {
      return build(function applySync(m) {
        m.toBeDefined();
      });
    },
    toBeNaN(): Promise<void> {
      return build(function applySync(m) {
        m.toBeNaN();
      });
    },
    toBeGreaterThan(n: number): Promise<void> {
      return build(function applySync(m) {
        m.toBeGreaterThan(n);
      });
    },
    toBeGreaterThanOrEqual(n: number): Promise<void> {
      return build(function applySync(m) {
        m.toBeGreaterThanOrEqual(n);
      });
    },
    toBeLessThan(n: number): Promise<void> {
      return build(function applySync(m) {
        m.toBeLessThan(n);
      });
    },
    toBeLessThanOrEqual(n: number): Promise<void> {
      return build(function applySync(m) {
        m.toBeLessThanOrEqual(n);
      });
    },
    toBeCloseTo(expected: number, numDigits?: number): Promise<void> {
      return build(function applySync(m) {
        m.toBeCloseTo(expected, numDigits);
      });
    },
    toMatch(pattern: string | RegExp): Promise<void> {
      return build(function applySync(m) {
        m.toMatch(pattern);
      });
    },
    toContain(item: unknown): Promise<void> {
      return build(function applySync(m) {
        m.toContain(item);
      });
    },
    toContainEqual(item: unknown): Promise<void> {
      return build(function applySync(m) {
        m.toContainEqual(item);
      });
    },
    toHaveLength(n: number): Promise<void> {
      return build(function applySync(m) {
        m.toHaveLength(n);
      });
    },
    toHaveProperty(keyPath: string | Array<string | number>, value?: unknown): Promise<void> {
      return build(function applySync(m) {
        m.toHaveProperty(keyPath, value);
      });
    },
    toMatchObject(subset: object): Promise<void> {
      return build(function applySync(m) {
        m.toMatchObject(subset);
      });
    },
    toThrow(expected?: unknown): Promise<void> {
      // For .rejects.toThrow, the settled value is the rejection (Error or value).
      // We match directly against it rather than calling the function-call toThrow.
      const _hasExpected = expected !== undefined;
      async function runRejectsToThrow(): Promise<void> {
        let settled: unknown;
        let didReject = false;
        try {
          settled = await (actual as Promise<unknown>);
        } catch (e) {
          didReject = true;
          settled = e;
        }
        if (wantReject !== didReject) {
          // D5/AC-98: count the assertion on the wrong-settlement path too.
          incAssertionCount();
          throw new Error(
            wantReject
              ? `expect(promise).rejects — promise resolved with ${show(settled)}`
              : `expect(promise).resolves — promise rejected with ${show(settled)}`,
          );
        }
        // For .resolves.toThrow — the resolved value must be a function (sync
        // semantics). Delegates to the sync matcher, which counts the assertion.
        if (!wantReject) {
          makeMatchersFn(settled, negated).toThrow(expected);
          return;
        }
        // For .rejects.toThrow — match the rejection value as the thrown error.
        // Count the assertion BEFORE any pass/fail throw (D5/AC-98: count EVERY
        // assertion call, not just the passing path). The .resolves.toThrow path
        // above delegates to the sync matcher which counts there, so this manual
        // increment is the only count for the .rejects path (no double-count).
        incAssertionCount();
        const pass = !_hasExpected || matchesThrow(settled, expected);
        if (negated ? pass : !pass) {
          throw new Error(
            negated
              ? `expect(promise).rejects.not.toThrow(${show(expected)}) — but it rejected with ${show(thrownMessage(settled))}`
              : `expect(promise).rejects.toThrow(${show(expected)}) — rejected with ${show(thrownMessage(settled))}`,
          );
        }
      }
      return runRejectsToThrow();
    },
    toHaveBeenCalled(): Promise<void> {
      return build(function applySync(m) {
        m.toHaveBeenCalled();
      });
    },
    toHaveBeenCalledTimes(n: number): Promise<void> {
      return build(function applySync(m) {
        m.toHaveBeenCalledTimes(n);
      });
    },
    toHaveBeenCalledWith(): Promise<void> {
      // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17
      const args = arguments;
      return build(function applySync(m) {
        m.toHaveBeenCalledWith.apply(m, args as unknown as unknown[]);
      });
    },
    toHaveBeenLastCalledWith(): Promise<void> {
      // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17
      const args = arguments;
      return build(function applySync(m) {
        m.toHaveBeenLastCalledWith.apply(m, args as unknown as unknown[]);
      });
    },
    toHaveBeenNthCalledWith(_n: number): Promise<void> {
      // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17
      const args = arguments;
      return build(function applySync(m) {
        (m.toHaveBeenNthCalledWith as (...a: unknown[]) => void).apply(
          m,
          args as unknown as unknown[],
        );
      });
    },
    toHaveReturned(): Promise<void> {
      return build(function applySync(m) {
        m.toHaveReturned();
      });
    },
    toHaveReturnedTimes(n: number): Promise<void> {
      return build(function applySync(m) {
        m.toHaveReturnedTimes(n);
      });
    },
    toHaveReturnedWith(value: unknown): Promise<void> {
      return build(function applySync(m) {
        m.toHaveReturnedWith(value);
      });
    },
    toHaveLastReturnedWith(value: unknown): Promise<void> {
      return build(function applySync(m) {
        m.toHaveLastReturnedWith(value);
      });
    },
    toHaveNthReturnedWith(n: number, value: unknown): Promise<void> {
      return build(function applySync(m) {
        m.toHaveNthReturnedWith(n, value);
      });
    },
  };

  // Install async wrappers for custom matchers
  const ck = Object.keys(customMatchers);
  for (let i = 0; i < ck.length; i++) {
    const name = ck[i];
    (am as Record<string, unknown>)[name] = function asyncCustomMatcher(): Promise<void> {
      // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17; arguments is intentional
      const capturedArgs = arguments;
      return build(function applySync(m) {
        (m as Record<string, (...a: unknown[]) => void>)[name].apply(
          m,
          capturedArgs as unknown as unknown[],
        );
      });
    };
  }

  return am;
}
