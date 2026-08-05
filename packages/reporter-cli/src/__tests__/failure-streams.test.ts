import type { RunOutcome, RunResult, SessionResult } from '@arguslab/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderFileOutcome, renderSessionSummary } from '../index.js';

/**
 * The message deliberately does NOT appear inside the stack. A real stack
 * repeats the message on its first line, which would make "how many times was
 * this message printed" unanswerable — two occurrences would be correct and
 * two occurrences would also be the bug.
 */
const MESSAGE = 'expect(1).toBe(2)';
const STACK = '    at toBe (bundle.js:1:1)\n    at counted (bundle.js:2:2)';

function failingResult(): RunResult {
  return {
    suites: [
      {
        name: 'math',
        suites: [],
        tests: [
          {
            name: 'adds',
            status: 'failed',
            failureMessage: MESSAGE,
            failureStack: STACK,
            durationMs: 1,
          },
        ],
      },
    ],
    totals: { passed: 0, failed: 1, skipped: 0, todo: 0, total: 1 },
    durationMs: 3,
    snap: [],
    snapFiltered: true,
  };
}

const failed: RunOutcome = { kind: 'failed', result: failingResult(), userLogs: [] };

/** Everything a run writes, split by stream and also as one interleaved capture. */
interface Captured {
  stdout: string;
  stderr: string;
  both: string;
}

function capture(run: () => void): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const both: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array): boolean => {
    out.push(String(s));
    both.push(String(s));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array): boolean => {
    err.push(String(s));
    both.push(String(s));
    return true;
  });
  run();
  return { stdout: out.join(''), stderr: err.join(''), both: both.join('') };
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

/** One whole run of one failing file: the per-file render, then the summary. */
function renderWholeSession(): Captured {
  const session: SessionResult = {
    files: [{ file: 'examples/math.test.ts', outcome: failed }],
    totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
  };
  return capture(() => {
    renderFileOutcome(failed);
    renderSessionSummary(session);
  });
}

/**
 * A failing test used to be rendered twice: in full by the per-file renderer on
 * stdout, and again by the session summary on stderr. Anyone capturing both
 * streams — which is what a terminal, a CI log and `2>&1` all do — saw every
 * failure message and every stack twice, and the second copy carried no
 * information the first did not.
 *
 * The detail is rendered once, where it has context: under its suite, in the
 * per-file block. The summary's job is aggregation, so it names the file and
 * stops.
 */
describe('a failure is reported exactly once', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints the failure message once across both streams', () => {
    expect(occurrences(renderWholeSession().both, MESSAGE)).toBe(1);
  });

  it('prints every stack frame once across both streams', () => {
    const { both } = renderWholeSession();

    for (const frame of STACK.trim().split('\n')) {
      expect(occurrences(both, frame.trim()), frame.trim()).toBe(1);
    }
  });

  it('still names the failing file in the summary', () => {
    expect(renderWholeSession().both).toContain('math.test.ts');
  });

  it('still reports the failure in the totals', () => {
    expect(renderWholeSession().both).toContain('1 files: 0 passed, 1 failed');
  });
});

/**
 * Which stream a line belongs on follows the taxonomy the exit codes already
 * use: `passed` and `failed` are RESULTS the run produced (exit 0 and 1), and
 * belong on stdout with the rest of the report. `timeout`,
 * `infrastructure-failure` and `protocol-failure` mean no result was produced
 * at all (exit 2) — those are diagnostics, and belong on stderr where they
 * survive `argus > report.txt`.
 */
describe('stream assignment follows the outcome taxonomy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes a test failure to stdout, not stderr', () => {
    const { stdout, stderr } = capture(() => renderFileOutcome(failed));

    expect(stdout).toContain(MESSAGE);
    expect(stderr).toBe('');
  });

  it('writes the whole summary of a failing run to stdout', () => {
    const { stderr } = renderWholeSession();

    expect(stderr).toBe('');
  });

  it.each([
    ['timeout', { kind: 'timeout', timeoutMs: 10, output: undefined }],
    [
      'infrastructure-failure',
      { kind: 'infrastructure-failure', stage: 'engine', message: 'no binary' },
    ],
    ['protocol-failure', { kind: 'protocol-failure', reason: 'no-result', rawStdout: '' }],
  ])('writes a %s to stderr, not stdout', (_label, outcome) => {
    const { stdout, stderr } = capture(() => renderFileOutcome(outcome as unknown as RunOutcome));

    expect(stderr.length).toBeGreaterThan(0);
    expect(stdout).toBe('');
  });
});
