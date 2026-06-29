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
      totals: { passed, failed, skipped: 0, total: passed + failed },
      durationMs: 0,
    },
  };
}

describe('parseHermesOutput', () => {
  it('clean exit + valid frame, no failures -> passed', () => {
    const o = parseHermesOutput(out({ stdout: frame(NONCE, okEnvelope(0)) }), NONCE);
    expect(o.kind).toBe('passed');
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
});
