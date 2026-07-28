import type { FileResult, SessionResult } from '@arguslab/core';

/**
 * Folds an array of per-file results into a SessionResult.
 *
 * Counting rules:
 *   - `kind: 'passed'`  → increments passed
 *   - `kind: 'failed'`  → increments failed
 *   - all other kinds   → not counted in passed/failed (but contribute to total
 *                         and to the worst-case exit code via exitCodeForSession)
 *   - skipped           → always 0 (not yet modelled at file level)
 */
export function foldOutcomes(files: FileResult[]): SessionResult {
  let passed = 0;
  let failed = 0;

  for (const { outcome } of files) {
    if (outcome.kind === 'passed') passed++;
    else if (outcome.kind === 'failed') failed++;
  }

  return {
    files,
    totals: {
      passed,
      failed,
      skipped: 0,
      total: files.length,
    },
  };
}
