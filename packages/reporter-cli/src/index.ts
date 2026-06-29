import type { Reporter, RunOutcome, RunResult, Suite } from '@argus/core';

/**
 * CliReporter renders a RunOutcome to the terminal. It handles ALL outcome
 * kinds — test results AND infrastructure/timeout/protocol failures. Test
 * output goes to stdout; failures and diagnostics go to stderr so severity is
 * not lost and does not compete with machine-readable stdout.
 */
export class CliReporter implements Reporter {
  async report(outcome: RunOutcome): Promise<void> {
    switch (outcome.kind) {
      case 'passed':
      case 'failed': {
        renderResult(outcome.result);
        if (outcome.userLogs.length > 0) {
          process.stdout.write(`\n[user logs]\n${outcome.userLogs.join('\n')}\n`);
        }
        return;
      }
      case 'timeout':
        process.stderr.write(`✗ TIMEOUT after ${outcome.timeoutMs} ms\n`);
        return;
      case 'infrastructure-failure':
        process.stderr.write(`✗ INFRASTRUCTURE FAILURE [${outcome.stage}] ${outcome.message}\n`);
        if (outcome.detail) process.stderr.write(`${outcome.detail}\n`);
        return;
      case 'protocol-failure':
        process.stderr.write(
          `✗ PROTOCOL FAILURE [${outcome.reason}]\n--- raw stdout ---\n${outcome.rawStdout}\n`,
        );
        return;
    }
  }
}

/** Process exit code for an outcome (SPEC §5.1): 0 pass, 1 fail, 2 everything else. */
export function exitCodeFor(outcome: RunOutcome): number {
  switch (outcome.kind) {
    case 'passed':
      return 0;
    case 'failed':
      return 1;
    default:
      return 2;
  }
}

function renderResult(result: RunResult): void {
  const lines: string[] = [];
  const walk = (s: Suite, indent: string): void => {
    lines.push(indent + s.name);
    for (const t of s.tests) {
      const mark = t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : '○';
      lines.push(
        `${indent}  ${mark} ${t.name}${t.failureMessage ? `  — ${t.failureMessage}` : ''}`,
      );
      if (t.status === 'failed' && t.failureStack) {
        const pad = `${indent}    `;
        lines.push(pad + t.failureStack.split('\n').join(`\n${pad}`));
      }
    }
    for (const c of s.suites) walk(c, `${indent}  `);
  };
  for (const s of result.suites) walk(s, '');
  const { passed, failed, total } = result.totals;
  lines.push(
    `\n${passed} passed, ${failed} failed, ${total} total (${result.durationMs} ms in Hermes)`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}
