import type { RunOutcome, RunResult, SessionResult } from '@arguslab/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSessionSummary } from '../index.js';

function result(passed: number, failed: number): RunResult {
  return {
    suites: [],
    totals: { passed, failed, skipped: 0, todo: 0, total: passed + failed },
    durationMs: 0,
    snap: [],
    snapFiltered: true,
  };
}

function passed(p: number): RunOutcome {
  return { kind: 'passed', result: result(p, 0), userLogs: [] };
}
function failed(p: number, f: number): RunOutcome {
  return { kind: 'failed', result: result(p, f), userLogs: [] };
}

describe('renderSessionSummary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints both file counts and aggregate test-level totals', () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array): boolean => {
      out.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((): boolean => true);

    const session: SessionResult = {
      files: [
        { file: 'a.test.ts', outcome: passed(2) },
        { file: 'b.test.ts', outcome: failed(1, 1) },
      ],
      totals: { passed: 1, failed: 1, skipped: 0, total: 2 },
    };

    renderSessionSummary(session);
    const text = out.join('');

    expect(text).toContain('2 files: 1 passed, 1 failed');
    // test-level totals summed across both files: 3 passed (2+1), 1 failed, 4 total
    expect(text).toContain('4 tests: 3 passed, 1 failed');
  });

  it('errored files contribute to file counts but not test totals', () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array): boolean => {
      out.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((): boolean => true);

    const session: SessionResult = {
      files: [
        { file: 'ok.test.ts', outcome: passed(3) },
        {
          file: 'boom.test.ts',
          outcome: { kind: 'infrastructure-failure', stage: 'engine', message: 'boom' },
        },
      ],
      totals: { passed: 1, failed: 0, skipped: 0, total: 2 },
    };

    renderSessionSummary(session);
    const text = out.join('');

    expect(text).toContain('2 files: 1 passed, 0 failed, 1 errored');
    expect(text).toContain('3 tests: 3 passed, 0 failed');
  });

  it('prints aggregate snapshot reconciliation counts', () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array): boolean => {
      out.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((): boolean => true);

    const run = result(1, 0);
    run.snap = [
      { key: 'a', value: 'a', testPassed: true, status: 'matched' },
      { key: 'b', value: 'b', testPassed: true, status: 'added' },
      { key: 'c', value: 'c', testPassed: true, status: 'updated' },
      { key: 'd', value: 'd', testPassed: false, status: 'failed' },
      { key: 'e', value: 'e', testPassed: false, status: 'removed' },
      { key: 'f', value: 'f', testPassed: false, status: 'obsolete' },
      { key: 'g', value: 'g', testPassed: false, status: 'discarded' },
    ];
    const session: SessionResult = {
      files: [{ file: 'snap.test.ts', outcome: { kind: 'passed', result: run, userLogs: [] } }],
      totals: { passed: 1, failed: 0, skipped: 0, total: 1 },
    };

    renderSessionSummary(session);

    expect(out.join('')).toContain(
      '7 snapshots: 1 matched, 1 added, 1 updated, 1 failed, 1 removed, 1 obsolete, 1 discarded',
    );
  });
});
