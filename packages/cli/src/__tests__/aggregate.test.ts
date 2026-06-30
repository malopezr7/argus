import type { FileResult, RunOutcome } from '@argus/core';
import { describe, expect, it } from 'vitest';
import { foldOutcomes } from '../aggregate.js';

// Minimal synthetic RunOutcome builders
const passed = (): RunOutcome => ({
  kind: 'passed',
  result: {
    suites: [],
    totals: { passed: 1, failed: 0, skipped: 0, todo: 0, total: 1 },
    durationMs: 1,
  },
  userLogs: [],
});

const failed = (): RunOutcome => ({
  kind: 'failed',
  result: {
    suites: [],
    totals: { passed: 0, failed: 1, skipped: 0, todo: 0, total: 1 },
    durationMs: 1,
  },
  userLogs: [],
});

const infraFailure = (): RunOutcome => ({
  kind: 'infrastructure-failure',
  stage: 'bundle',
  message: 'build error',
});

const timeout = (): RunOutcome => ({
  kind: 'timeout',
  timeoutMs: 10_000,
  output: {
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: 'SIGKILL',
    timedOut: true,
    durationMs: 10_001,
  },
});

const fileResult = (file: string, outcome: RunOutcome): FileResult => ({ file, outcome });

describe('foldOutcomes', () => {
  it('(a) all passed → totals.failed = 0, totals.passed = N', () => {
    const files = [
      fileResult('/a.test.ts', passed()),
      fileResult('/b.test.ts', passed()),
      fileResult('/c.test.ts', passed()),
    ];
    const session = foldOutcomes(files);

    expect(session.totals.passed).toBe(3);
    expect(session.totals.failed).toBe(0);
    expect(session.totals.total).toBe(3);
    expect(session.totals.skipped).toBe(0);
  });

  it('(b) one failed → totals.failed = 1', () => {
    const files = [
      fileResult('/a.test.ts', passed()),
      fileResult('/b.test.ts', failed()),
      fileResult('/c.test.ts', passed()),
    ];
    const session = foldOutcomes(files);

    expect(session.totals.failed).toBe(1);
    expect(session.totals.passed).toBe(2);
    expect(session.totals.total).toBe(3);
  });

  it('(c) infra/timeout files not counted in passed/failed but are in total', () => {
    const files = [
      fileResult('/a.test.ts', passed()),
      fileResult('/b.test.ts', infraFailure()),
      fileResult('/c.test.ts', timeout()),
    ];
    const session = foldOutcomes(files);

    // infra and timeout don't go into passed or failed counts
    expect(session.totals.passed).toBe(1);
    expect(session.totals.failed).toBe(0);
    expect(session.totals.total).toBe(3);
    // but they appear in the files list
    expect(session.files).toHaveLength(3);
  });

  it('(d) empty input → all zeros', () => {
    const session = foldOutcomes([]);

    expect(session).toEqual({
      files: [],
      totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
    });
  });

  it('files array is preserved in order', () => {
    const a = fileResult('/a.test.ts', passed());
    const b = fileResult('/b.test.ts', failed());
    const session = foldOutcomes([a, b]);

    expect(session.files[0].file).toBe('/a.test.ts');
    expect(session.files[1].file).toBe('/b.test.ts');
  });
});
