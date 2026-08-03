/**
 * @arguslab/framework — pure hook-chain execution helpers.
 *
 * All helpers are async function declarations (no async arrows).
 * No for..of, no spread. Index loops only.
 * No imports from @arguslab/core or Node built-ins.
 *
 * Error policy:
 *  - beforeAll throws → store error; all block+nested tests fail; afterAll still runs.
 *  - beforeEach throws → test fails, body skipped; afterEach chain still runs.
 *  - afterEach throws → test fails/annotated; remaining afterEach hooks still run.
 *  - afterAll throws → synthetic failed test emitted; remaining afterAll hooks still run.
 */

import type { PendingSuite } from './jest-api.js';

// ---------------------------------------------------------------------------
// Idempotent beforeAll guard type
// ---------------------------------------------------------------------------

export interface IdempotentGuard {
  ran: boolean;
}

// ---------------------------------------------------------------------------
// runBeforeAll
// ---------------------------------------------------------------------------

/**
 * Run each suite.beforeAll[i] in index order (once per block via guard).
 * Returns the first Error thrown, or undefined.
 */
export async function runBeforeAll(
  suite: PendingSuite,
  guard: IdempotentGuard,
): Promise<Error | undefined> {
  if (guard.ran) return undefined;
  guard.ran = true;
  for (let i = 0; i < suite.beforeAll.length; i++) {
    try {
      await suite.beforeAll[i]();
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// runAfterAll
// ---------------------------------------------------------------------------

/**
 * Run each suite.afterAll[i] in index order. Collects first error but always
 * drains all hooks. Returns first error or undefined.
 */
export async function runAfterAll(suite: PendingSuite): Promise<Error | undefined> {
  let firstError: Error | undefined;
  for (let i = 0; i < suite.afterAll.length; i++) {
    try {
      await suite.afterAll[i]();
    } catch (e) {
      if (firstError === undefined) {
        firstError = e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  return firstError;
}

// ---------------------------------------------------------------------------
// runBeforeEachChain
// ---------------------------------------------------------------------------

/**
 * Run beforeEach for all suites in chain (outer → inner order, i.e. chain[0]
 * first). Stops at first throw and returns the error. afterEach will still run
 * via runAfterEachChain in the caller.
 */
export async function runBeforeEachChain(chain: PendingSuite[]): Promise<Error | undefined> {
  for (let i = 0; i < chain.length; i++) {
    const suite = chain[i];
    for (let j = 0; j < suite.beforeEach.length; j++) {
      try {
        await suite.beforeEach[j]();
      } catch (e) {
        return e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// runAfterEachChain
// ---------------------------------------------------------------------------

/**
 * Run afterEach for all suites in chain (inner → outer order, i.e. chain[n-1]
 * first). Always drains all hooks even on error. Returns first error.
 */
export async function runAfterEachChain(chain: PendingSuite[]): Promise<Error | undefined> {
  let firstError: Error | undefined;
  for (let i = chain.length - 1; i >= 0; i--) {
    const suite = chain[i];
    for (let j = 0; j < suite.afterEach.length; j++) {
      try {
        await suite.afterEach[j]();
      } catch (e) {
        if (firstError === undefined) {
          firstError = e instanceof Error ? e : new Error(String(e));
        }
      }
    }
  }
  return firstError;
}
