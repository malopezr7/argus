import type { RunOutcome, RunResult, SessionResult, Suite } from '@arguslab/core';

/**
 * Render a single RunOutcome to the terminal. cli.ts calls it directly, in
 * discovery order, as mapPool resolves.
 *
 * STREAM ASSIGNMENT follows the outcome taxonomy the exit codes already encode:
 *
 *   passed / failed                → stdout. These are RESULTS (exit 0 and 1).
 *                                    A failing test is an answer, not an error.
 *   timeout / infrastructure /     → stderr. No result was produced at all
 *   protocol failure                 (exit 2). These are diagnostics, and they
 *                                    must survive `argus > report.txt`.
 *
 * This is the ONLY place a test result is rendered in full. The session summary
 * aggregates; it does not re-print what was already written here.
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

/** Process exit code for an outcome: 0 pass, 1 fail, 2 everything else. */
function exitCodeFor(outcome: RunOutcome): number {
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
 * Renders a per-file recap and the session totals.
 *
 * A RECAP, not a second report. It names each file and how it ended; the
 * per-test messages and stacks were already written in full, in context, by
 * `renderFileOutcome`. Repeating them here printed every failure twice — once
 * on stdout and once on stderr — so a terminal, a CI log, or any `2>&1` showed
 * the whole failure doubled, with the second copy carrying nothing new.
 *
 * Streams follow the same taxonomy as `renderFileOutcome`: results on stdout,
 * runs that produced no result on stderr.
 */
export function renderSessionSummary(session: SessionResult): void {
  for (const { file, outcome } of session.files) {
    const label = file.split('/').pop() ?? file;
    switch (outcome.kind) {
      case 'passed':
        process.stdout.write(`  ✓ ${label}\n`);
        break;
      case 'failed':
        process.stdout.write(
          `  ✗ ${label} (${outcome.result.totals.failed} of ${outcome.result.totals.total} failed)\n`,
        );
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

  const snapshotCounts = {
    matched: 0,
    added: 0,
    updated: 0,
    failed: 0,
    removed: 0,
    obsolete: 0,
    discarded: 0,
  };
  for (const { outcome } of session.files) {
    if (outcome.kind !== 'passed' && outcome.kind !== 'failed') continue;
    for (const snapshot of outcome.result.snap) {
      if (snapshot.status !== 'unchecked') snapshotCounts[snapshot.status]++;
    }
  }
  const snapshotTotal =
    snapshotCounts.matched +
    snapshotCounts.added +
    snapshotCounts.updated +
    snapshotCounts.failed +
    snapshotCounts.removed +
    snapshotCounts.obsolete +
    snapshotCounts.discarded;
  if (snapshotTotal > 0) {
    process.stdout.write(
      `${snapshotTotal} snapshots: ${snapshotCounts.matched} matched, ${snapshotCounts.added} added, ` +
        `${snapshotCounts.updated} updated, ${snapshotCounts.failed} failed, ` +
        `${snapshotCounts.removed} removed, ${snapshotCounts.obsolete} obsolete, ` +
        `${snapshotCounts.discarded} discarded\n`,
    );
  }
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
