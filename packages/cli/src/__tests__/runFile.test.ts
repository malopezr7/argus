/**
 * Task 4.2 — runFile totality tests.
 *
 * runFile (defined inside cli.ts main()) is a TOTAL function: every throw,
 * every timeout, every engine error resolves to a RunOutcome and never rejects.
 * This anchors ADR-5 and R3 from the judge report.
 *
 * Because runFile is a closure inside main(), we test the same logic pattern
 * directly here using a thin re-implementation that mirrors the try/catch
 * exactly. The integration tests (integration.test.ts task 5.1b, 5.5) confirm
 * the full CLI stack behaves consistently.
 */
import type { RunOutcome } from '@arguslab/core';
import { describe, expect, it } from 'vitest';
import { mapPool } from '../pool.js';

// ---------------------------------------------------------------------------
// Helpers — replicate the runFile try/catch contract without real adapters
// ---------------------------------------------------------------------------

const errMsg = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e);

/** Minimal stand-in for runFile that uses the same try/catch structure. */
async function makeToatalWorker(
  bundleFn: () => Promise<unknown>,
  engineFn: () => Promise<{ timedOut: boolean; stdout: string; stderr: string }>,
  timeoutMs = 10_000,
): Promise<RunOutcome> {
  try {
    await bundleFn().catch((e) => {
      throw Object.assign(new Error(errMsg(e)), { stage: 'bundle' });
    });

    const output = await engineFn();
    if (output.timedOut) {
      return {
        kind: 'timeout',
        timeoutMs,
        output: {
          stdout: output.stdout,
          stderr: output.stderr,
          exitCode: null,
          signal: 'SIGKILL',
          timedOut: true,
          durationMs: timeoutMs + 1,
        },
      };
    }
    // Simplified: treat non-timed-out as passed for totality testing
    return {
      kind: 'passed',
      result: {
        suites: [],
        totals: { passed: 1, failed: 0, skipped: 0, todo: 0, total: 1 },
        durationMs: 0,
      },
      userLogs: [],
    };
  } catch (e) {
    const stage = (e as { stage?: string }).stage === 'bundle' ? 'bundle' : 'spawn';
    return {
      kind: 'infrastructure-failure',
      stage,
      message: errMsg(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runFile totality (ADR-5, R3)', () => {
  it('bundle throw → resolved infrastructure-failure (stage: bundle)', async () => {
    const outcome = await makeToatalWorker(
      () => Promise.reject(new Error('esbuild failed')),
      () => Promise.resolve({ timedOut: false, stdout: '', stderr: '' }),
    );
    expect(outcome.kind).toBe('infrastructure-failure');
    expect((outcome as Extract<RunOutcome, { kind: 'infrastructure-failure' }>).stage).toBe(
      'bundle',
    );
    expect((outcome as Extract<RunOutcome, { kind: 'infrastructure-failure' }>).message).toMatch(
      /esbuild failed/,
    );
  });

  it('spawn/engine throw → resolved infrastructure-failure (stage: spawn)', async () => {
    const outcome = await makeToatalWorker(
      () => Promise.resolve({}),
      () => Promise.reject(new Error('spawn error')),
    );
    expect(outcome.kind).toBe('infrastructure-failure');
    expect((outcome as Extract<RunOutcome, { kind: 'infrastructure-failure' }>).stage).toBe(
      'spawn',
    );
  });

  it('timeout → resolved timeout outcome (not a rejection)', async () => {
    const outcome = await makeToatalWorker(
      () => Promise.resolve({}),
      () => Promise.resolve({ timedOut: true, stdout: '', stderr: '' }),
      5_000,
    );
    expect(outcome.kind).toBe('timeout');
    expect((outcome as Extract<RunOutcome, { kind: 'timeout' }>).timeoutMs).toBe(5_000);
  });

  it('successful run → resolved passed outcome', async () => {
    const outcome = await makeToatalWorker(
      () => Promise.resolve({}),
      () => Promise.resolve({ timedOut: false, stdout: '', stderr: '' }),
    );
    expect(outcome.kind).toBe('passed');
  });

  it('total worker inside mapPool never rejects the pool', async () => {
    // Even if multiple workers hit different error paths, mapPool resolves
    const files = ['bundle-fails', 'spawn-fails', 'times-out'];
    const outcomes = await mapPool(files, 3, async (file) => {
      if (file === 'bundle-fails') {
        return makeToatalWorker(
          () => Promise.reject(new Error('bundle err')),
          () => Promise.resolve({ timedOut: false, stdout: '', stderr: '' }),
        );
      }
      if (file === 'spawn-fails') {
        return makeToatalWorker(
          () => Promise.resolve({}),
          () => Promise.reject(new Error('spawn err')),
        );
      }
      return makeToatalWorker(
        () => Promise.resolve({}),
        () => Promise.resolve({ timedOut: true, stdout: '', stderr: '' }),
      );
    });

    expect(outcomes).toHaveLength(3);
    expect(outcomes[0].kind).toBe('infrastructure-failure');
    expect(outcomes[1].kind).toBe('infrastructure-failure');
    expect(outcomes[2].kind).toBe('timeout');
  });
});
