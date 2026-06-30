import type { RunOutcome, SessionResult } from '@argus/core';
import { describe, expect, it } from 'vitest';
import { exitCodeForSession } from '../index.js';

// Synthetic RunOutcome builders
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
  message: 'error',
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

function session(outcomes: RunOutcome[]): SessionResult {
  let p = 0;
  let f = 0;
  for (const o of outcomes) {
    if (o.kind === 'passed') p++;
    else if (o.kind === 'failed') f++;
  }
  return {
    files: outcomes.map((o, i) => ({ file: `/file${i}.test.ts`, outcome: o })),
    totals: { passed: p, failed: f, skipped: 0, total: outcomes.length },
  };
}

describe('exitCodeForSession', () => {
  it('(a) all passed → exit 0', () => {
    expect(exitCodeForSession(session([passed(), passed(), passed()]))).toBe(0);
  });

  it('(b) one failed, no infra → exit 1', () => {
    expect(exitCodeForSession(session([passed(), failed(), passed()]))).toBe(1);
  });

  it('(c) infrastructure-failure present → exit 2', () => {
    expect(exitCodeForSession(session([passed(), failed(), infraFailure()]))).toBe(2);
  });

  it('(d) timeout present → exit 2', () => {
    expect(exitCodeForSession(session([passed(), timeout()]))).toBe(2);
  });

  it('(e) empty session → exit 2 (not -Infinity)', () => {
    expect(exitCodeForSession(session([]))).toBe(2);
  });

  it('single passed file → exit 0', () => {
    expect(exitCodeForSession(session([passed()]))).toBe(0);
  });

  it('single failed file → exit 1', () => {
    expect(exitCodeForSession(session([failed()]))).toBe(1);
  });
});
