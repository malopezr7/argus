/**
 * @arguslab/framework — assertion counter + custom-matcher registry
 *
 * Extracted from matchers.ts to keep each module under ~500 LOC.
 * This module has NO imports from other local modules — it is the
 * leaf-most node in the dependency graph.
 *
 * HERMES 0.17 ENVELOPE RULES: no async arrows / generators / await,
 * no for..of / spread, no Array.prototype methods, no WeakRef.
 */

// ---------------------------------------------------------------------------
// Assertion counter — increments on every assert call
// ---------------------------------------------------------------------------

let assertionCount = 0;
let expectedAssertions: { mode: 'exact' | 'min'; n: number } | null = null;

export function resetAssertions(): void {
  assertionCount = 0;
  expectedAssertions = null;
}

export function verifyAssertions(): Error | undefined {
  if (expectedAssertions === null) return undefined;
  if (expectedAssertions.mode === 'exact') {
    if (assertionCount !== expectedAssertions.n) {
      return new Error(
        `expect.assertions(${expectedAssertions.n}) — ${assertionCount} assertion(s) ran`,
      );
    }
  } else {
    // min (hasAssertions)
    if (assertionCount < expectedAssertions.n) {
      return new Error(`expect.hasAssertions() — 0 assertions ran`);
    }
  }
  return undefined;
}

/** Increment the assertion counter. Called once per assert invocation. */
export function incAssertionCount(): void {
  assertionCount++;
}

/** Set exact assertion expectation (expect.assertions(n)). */
export function setExpectedAssertions(mode: 'exact' | 'min', n: number): void {
  expectedAssertions = { mode, n };
}

/**
 * Wrap every data-property method of a matchers object so the assertion counter
 * increments ONCE on entry — before any matcher body can throw a
 * usage/guard error. The `.not`/`.resolves`/`.rejects` accessors are sub-matcher
 * selectors (their descriptor has `get`, not `value`), so they are skipped.
 *
 * `orig` is captured as a FUNCTION PARAMETER (makeCounted), never a loop-local
 * `const`: esbuild lowers block-scoped loop vars to function-scoped `var` for the
 * Hermes target, which would make every wrapper close over the LAST method.
 */
export function installAssertionCounting(m: Record<string, unknown>): void {
  function makeCounted(orig: (...a: unknown[]) => unknown): () => unknown {
    return function counted(): unknown {
      assertionCount++;
      // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17
      return orig.apply(m, arguments as unknown as unknown[]);
    };
  }
  const names = Object.getOwnPropertyNames(m);
  for (let i = 0; i < names.length; i++) {
    const d = Object.getOwnPropertyDescriptor(m, names[i]);
    if (d !== undefined && typeof d.value === 'function') {
      m[names[i]] = makeCounted(d.value as (...a: unknown[]) => unknown);
    }
  }
}

// ---------------------------------------------------------------------------
// Custom matchers registry
// ---------------------------------------------------------------------------

export type CustomMatcherFn = (
  this: { isNot: boolean; equals: (a: unknown, b: unknown) => boolean },
  actual: unknown,
  ...args: unknown[]
) => { pass: boolean; message: () => string };

export const customMatchers: Record<string, CustomMatcherFn> = {};
