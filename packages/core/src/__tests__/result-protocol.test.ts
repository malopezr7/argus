import { describe, expect, it } from 'vitest';
import type { EngineOutput } from '../domain/types.js';
import { ARGUS_RESULT_PREFIX } from '../domain/types.js';
import { parseHermesOutput } from '../result-protocol.js';

const NONCE = 'secretnonce123';

function out(partial: Partial<EngineOutput>): EngineOutput {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 1,
    ...partial,
  };
}

function frame(nonce: string, payload: unknown): string {
  return `${ARGUS_RESULT_PREFIX + nonce}:${JSON.stringify(payload)}`;
}

function okEnvelope(failed: number): unknown {
  const passed = failed === 0 ? 1 : 0;
  return {
    v: 1,
    ok: true,
    result: {
      suites: [],
      totals: { passed, failed, skipped: 0, todo: 0, total: passed + failed },
      durationMs: 0,
    },
  };
}

describe('parseHermesOutput', () => {
  it('clean exit + valid frame, no failures -> passed', () => {
    const o = parseHermesOutput(out({ stdout: frame(NONCE, okEnvelope(0)) }), NONCE);
    expect(o.kind).toBe('passed');
    expect(o.kind === 'passed' && o.result.snap).toEqual([]);
    expect(o.kind === 'passed' && o.result.snapFiltered).toBe(true);
  });

  it('merges optional snapshot envelope fields into mandatory RunResult fields', () => {
    const payload = okEnvelope(0) as Record<string, unknown>;
    payload.snap = [{ key: 'suite test 1', value: '"value"', passed: true }];
    payload.snapFiltered = false;

    const o = parseHermesOutput(out({ stdout: frame(NONCE, payload) }), NONCE);

    expect(o.kind).toBe('passed');
    expect(o.kind === 'passed' && o.result.snap).toEqual([
      {
        key: 'suite test 1',
        value: '"value"',
        testPassed: true,
        status: 'unchecked',
      },
    ]);
    expect(o.kind === 'passed' && o.result.snapFiltered).toBe(false);
  });

  it.each([
    [[{ key: 'x', value: 'y' }]],
    [[{ key: 'x', value: 'y', passed: 'yes' }]],
    [[{ key: 'bad\u0000key', value: 'y', passed: true }]],
    [
      [
        { key: 'duplicate', value: 'a', passed: true },
        { key: 'duplicate', value: 'b', passed: true },
      ],
    ],
  ])('rejects malformed snapshot wire entries %#', (snap) => {
    const payload = okEnvelope(0) as Record<string, unknown>;
    payload.snap = snap;
    payload.snapFiltered = false;

    const o = parseHermesOutput(out({ stdout: frame(NONCE, payload) }), NONCE);

    expect(o.kind).toBe('protocol-failure');
  });

  it('clean exit + valid frame, with failures -> failed', () => {
    const o = parseHermesOutput(out({ stdout: frame(NONCE, okEnvelope(2)) }), NONCE);
    expect(o.kind).toBe('failed');
  });

  it('preserves non-frame stdout lines as user logs', () => {
    const o = parseHermesOutput(
      out({ stdout: `hello from user\n${frame(NONCE, okEnvelope(0))}` }),
      NONCE,
    );
    expect(o.kind === 'passed' && o.userLogs).toEqual(['hello from user']);
  });

  it('nonzero exit + valid frame -> infrastructure-failure (frame-before-crash defence)', () => {
    const o = parseHermesOutput(out({ stdout: frame(NONCE, okEnvelope(0)), exitCode: 1 }), NONCE);
    expect(o.kind).toBe('infrastructure-failure');
  });

  it('terminating signal + valid frame -> infrastructure-failure', () => {
    const o = parseHermesOutput(
      out({ stdout: frame(NONCE, okEnvelope(0)), exitCode: null, signal: 'SIGKILL' }),
      NONCE,
    );
    expect(o.kind).toBe('infrastructure-failure');
  });

  it('forged frame with the WRONG nonce is ignored -> missing-frame', () => {
    const o = parseHermesOutput(out({ stdout: frame('not-the-nonce', okEnvelope(0)) }), NONCE);
    expect(o.kind === 'protocol-failure' && o.reason).toBe('missing-frame');
  });

  it('two valid frames -> multiple-frames', () => {
    const stdout = `${frame(NONCE, okEnvelope(0))}\n${frame(NONCE, okEnvelope(0))}`;
    const o = parseHermesOutput(out({ stdout }), NONCE);
    expect(o.kind === 'protocol-failure' && o.reason).toBe('multiple-frames');
  });

  it('malformed JSON after the marker -> malformed-json', () => {
    const o = parseHermesOutput(
      out({ stdout: `${ARGUS_RESULT_PREFIX + NONCE}:{not valid json` }),
      NONCE,
    );
    expect(o.kind === 'protocol-failure' && o.reason).toBe('malformed-json');
  });

  it('ok:false envelope -> infrastructure-failure', () => {
    const o = parseHermesOutput(
      out({ stdout: frame(NONCE, { v: 1, ok: false, error: { message: 'boom' } }) }),
      NONCE,
    );
    expect(o.kind).toBe('infrastructure-failure');
  });

  it('no frame on a clean exit -> missing-frame', () => {
    const o = parseHermesOutput(out({ stdout: 'just some output\n' }), NONCE);
    expect(o.kind === 'protocol-failure' && o.reason).toBe('missing-frame');
  });

  // isTotals validates the counts invariant when a todo field is present
  it('isTotals accepts {passed:1,failed:0,skipped:1,todo:1,total:3}', () => {
    const payload = {
      v: 1,
      ok: true,
      result: {
        suites: [],
        totals: { passed: 1, failed: 0, skipped: 1, todo: 1, total: 3 },
        durationMs: 0,
      },
    };
    const o = parseHermesOutput(out({ stdout: frame(NONCE, payload) }), NONCE);
    // totals.failed === 0 → kind = 'passed'; important: it's not protocol-failure
    expect(o.kind).toBe('passed');
    expect(o.kind).not.toBe('protocol-failure');
  });

  it('isTestCaseShape accepts status:"todo"', () => {
    const payload = {
      v: 1,
      ok: true,
      result: {
        suites: [
          {
            name: 's',
            suites: [],
            tests: [{ name: 'n', status: 'todo', durationMs: 0 }],
          },
        ],
        totals: { passed: 0, failed: 0, skipped: 0, todo: 1, total: 1 },
        durationMs: 0,
      },
    };
    const o = parseHermesOutput(out({ stdout: frame(NONCE, payload) }), NONCE);
    expect(o.kind).toBe('passed'); // totals.failed=0, all valid
  });

  it('isTotals rejects totals object missing todo field', () => {
    const payload = {
      v: 1,
      ok: true,
      result: {
        suites: [],
        totals: { passed: 1, failed: 0, skipped: 0, total: 1 }, // no todo
        durationMs: 0,
      },
    };
    const o = parseHermesOutput(out({ stdout: frame(NONCE, payload) }), NONCE);
    expect(o.kind).toBe('protocol-failure');
    expect((o as Extract<typeof o, { kind: 'protocol-failure' }>).reason).toBe('malformed-json');
  });
});
