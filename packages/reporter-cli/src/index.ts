import type { Reporter, RunOutcome, RunResult, SessionResult, Suite } from '@arguslab/core';

/**
 * Render a single RunOutcome to the terminal. Extracted from CliReporter.report
 * so cli.ts can call it directly in discovery order after mapPool resolves.
 *
 * Test output goes to stdout; failures and diagnostics go to stderr.
 * Byte-identical to the original CliReporter.report switch body.
 */
export function renderFileOutcome(outcome: RunOutcome): void {
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

/**
 * CliReporter renders a RunOutcome to the terminal. It handles ALL outcome
 * kinds — test results AND infrastructure/timeout/protocol failures. Test
 * output goes to stdout; failures and diagnostics go to stderr so severity is
 * not lost and does not compete with machine-readable stdout.
 */
export class CliReporter implements Reporter {
  async report(outcome: RunOutcome): Promise<void> {
    renderFileOutcome(outcome);
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

/**
 * Returns the worst-case exit code across all files in a session.
 * Precedence: 2 (infra/timeout/protocol) > 1 (test failure) > 0 (all passed).
 * Returns 2 when the session has zero files (discover infra-failure).
 */
export function exitCodeForSession(session: SessionResult): number {
  if (session.files.length === 0) return 2;
  let max = 0;
  for (const { outcome } of session.files) {
    const code = exitCodeFor(outcome);
    if (code > max) max = code;
    if (max === 2) break; // short-circuit — can't go higher
  }
  return max;
}

/**
 * Renders a per-file and session-level summary to stdout/stderr.
 * Failures and diagnostics go to stderr; passing output and the summary
 * line go to stdout — matching machine-readable conventions.
 */
export function renderSessionSummary(session: SessionResult): void {
  for (const { file, outcome } of session.files) {
    const label = file.split('/').pop() ?? file;
    switch (outcome.kind) {
      case 'passed':
        process.stdout.write(`  ✓ ${label}\n`);
        break;
      case 'failed':
        process.stdout.write(`  ✗ ${label} (test failure)\n`);
        renderFileFailures(outcome.result, file);
        break;
      case 'timeout':
        process.stderr.write(`  ✗ ${label} — TIMEOUT after ${outcome.timeoutMs} ms\n`);
        break;
      case 'infrastructure-failure':
        process.stderr.write(
          `  ✗ ${label} — INFRASTRUCTURE FAILURE [${outcome.stage}] ${outcome.message}\n`,
        );
        break;
      case 'protocol-failure':
        process.stderr.write(`  ✗ ${label} — PROTOCOL FAILURE [${outcome.reason}]\n`);
        break;
    }
  }

  const { passed, failed, total } = session.totals;
  const errored = total - passed - failed;
  const fileParts: string[] = [`${passed} passed`, `${failed} failed`];
  if (errored > 0) fileParts.push(`${errored} errored`);

  // Aggregate test-level totals across the files that actually executed.
  let testsPassed = 0;
  let testsFailed = 0;
  let testsTodo = 0;
  let testsTotal = 0;
  for (const { outcome } of session.files) {
    if (outcome.kind === 'passed' || outcome.kind === 'failed') {
      testsPassed += outcome.result.totals.passed;
      testsFailed += outcome.result.totals.failed;
      testsTodo += outcome.result.totals.todo ?? 0;
      testsTotal += outcome.result.totals.total;
    }
  }

  process.stdout.write(
    `\n${total} files: ${fileParts.join(', ')}` +
      `\n${testsTotal} tests: ${testsPassed} passed, ${testsFailed} failed, ${testsTodo} todo\n`,
  );
}

function renderFileFailures(result: RunResult, _file: string): void {
  const walk = (s: Suite, indent: string): void => {
    for (const t of s.tests) {
      if (t.status === 'failed') {
        process.stderr.write(`    ✗ ${t.name}`);
        if (t.failureMessage) process.stderr.write(`  — ${t.failureMessage}`);
        process.stderr.write('\n');
        if (t.failureStack) {
          const pad = '      ';
          process.stderr.write(`${pad + t.failureStack.split('\n').join(`\n${pad}`)}\n`);
        }
      }
    }
    for (const c of s.suites) walk(c, `${indent}  `);
  };
  for (const s of result.suites) walk(s, '');
}

function renderResult(result: RunResult): void {
  const lines: string[] = [];
  const walk = (s: Suite, indent: string): void => {
    lines.push(indent + s.name);
    for (const t of s.tests) {
      const mark =
        t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : t.status === 'todo' ? '✎' : '○';
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
  const testsTodo = result.totals.todo ?? 0;
  lines.push(
    `\n${passed} passed, ${failed} failed, ${testsTodo} todo, ${total} total (${result.durationMs} ms in Hermes)`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}
