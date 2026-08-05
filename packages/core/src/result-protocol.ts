import type { EngineOutput, RunOutcome, RunResult } from './domain/types.js';
import { ARGUS_RESULT_PREFIX } from './domain/types.js';

/**
 * Parse a Hermes subprocess's stdout into a RunOutcome.
 *
 * The framework emits ONE framed line: `__ARGUS_RESULT__:<nonce>:<json>`. The
 * <nonce> is a per-run secret passed privately to run(nonce) — user code never
 * sees it, so it cannot forge the frame. We:
 *  1. Treat ANY nonzero exit / terminating signal as an infrastructure failure,
 *     EVEN IF a frame is present (defends against a frame printed before a later
 *     top-level crash). A clean test run — pass OR fail — exits 0.
 *  2. Accept ONLY a line matching the full marker (prefix + nonce + ':').
 *  3. Validate the JSON envelope shape (no blind dereference).
 *  4. Preserve every other non-empty line as a user log.
 *
 * Timeouts are decided by the caller (it knows timeoutMs); this function assumes
 * the process completed (was not killed by the timeout watchdog).
 */
export function parseHermesOutput(output: EngineOutput, resultNonce: string): RunOutcome {
  if (output.exitCode !== 0 || output.signal !== null) {
    return {
      kind: 'infrastructure-failure',
      stage: 'engine',
      message: `hermes exited exitCode=${output.exitCode} signal=${output.signal}`,
      detail: output.stderr.trim() || undefined,
    };
  }

  const marker = `${ARGUS_RESULT_PREFIX + resultNonce}:`;
  const lines = output.stdout.split('\n');
  const frames = lines.filter((l) => l.startsWith(marker));
  const userLogs = lines.filter((l) => l.length > 0 && !l.startsWith(marker));

  if (frames.length === 0) {
    return { kind: 'protocol-failure', reason: 'missing-frame', rawStdout: output.stdout };
  }
  if (frames.length > 1) {
    return { kind: 'protocol-failure', reason: 'multiple-frames', rawStdout: output.stdout };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(frames[0].slice(marker.length));
  } catch {
    return { kind: 'protocol-failure', reason: 'malformed-json', rawStdout: output.stdout };
  }

  if (!isEnvelope(payload)) {
    return { kind: 'protocol-failure', reason: 'malformed-json', rawStdout: output.stdout };
  }
  if (!payload.ok) {
    return {
      kind: 'infrastructure-failure',
      stage: 'engine',
      message: payload.error?.message ?? 'framework reported a fatal error',
      detail: payload.error?.stack,
    };
  }
  if (!isRunResult(payload.result)) {
    return { kind: 'protocol-failure', reason: 'malformed-json', rawStdout: output.stdout };
  }
  const snap = parseSnapshots(payload.snap);
  if (snap === undefined) {
    return { kind: 'protocol-failure', reason: 'malformed-json', rawStdout: output.stdout };
  }
  if (payload.snapFiltered !== undefined && typeof payload.snapFiltered !== 'boolean') {
    return { kind: 'protocol-failure', reason: 'malformed-json', rawStdout: output.stdout };
  }
  const result: RunResult = {
    ...payload.result,
    snap,
    snapFiltered: payload.snapFiltered ?? true,
  };
  return result.totals.failed > 0
    ? { kind: 'failed', result, userLogs }
    : { kind: 'passed', result, userLogs };
}

interface ResultEnvelope {
  v: number;
  ok: boolean;
  result?: unknown;
  error?: { message?: string; stack?: string };
  snap?: unknown;
  snapFiltered?: unknown;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isEnvelope(x: unknown): x is ResultEnvelope {
  return isObject(x) && x.v === 1 && typeof x.ok === 'boolean';
}

function isFiniteNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isTotals(x: unknown): boolean {
  if (!isObject(x)) return false;
  const { passed, failed, skipped, todo, total } = x;
  if (![passed, failed, skipped, todo, total].every(isFiniteNonNegInt)) return false;
  // Counts must be internally consistent.
  return (
    (passed as number) + (failed as number) + (skipped as number) + (todo as number) ===
    (total as number)
  );
}

function isTestCaseShape(x: unknown): boolean {
  if (!isObject(x)) return false;
  if (typeof x.name !== 'string') return false;
  return (
    x.status === 'passed' || x.status === 'failed' || x.status === 'skipped' || x.status === 'todo'
  );
}

function isSuiteShape(x: unknown): boolean {
  if (!isObject(x)) return false;
  if (typeof x.name !== 'string') return false;
  if (!Array.isArray(x.tests) || !x.tests.every(isTestCaseShape)) return false;
  if (!Array.isArray(x.suites) || !x.suites.every(isSuiteShape)) return false;
  return true;
}

function isRunResult(x: unknown): x is Omit<RunResult, 'snap' | 'snapFiltered'> {
  if (!isObject(x)) return false;
  if (typeof x.durationMs !== 'number' || !Number.isFinite(x.durationMs)) return false;
  if (!isTotals(x.totals)) return false;
  if (!Array.isArray(x.suites) || !x.suites.every(isSuiteShape)) return false;
  return true;
}

function hasC0(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

function parseSnapshots(value: unknown): RunResult['snap'] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;

  const seen = new Set<string>();
  const result: RunResult['snap'] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!isObject(item)) return undefined;
    if (typeof item.key !== 'string' || hasC0(item.key)) return undefined;
    if (typeof item.value !== 'string' || typeof item.passed !== 'boolean') return undefined;
    if (seen.has(item.key)) return undefined;
    seen.add(item.key);
    result.push({
      key: item.key,
      value: item.value,
      testPassed: item.passed,
      status: 'unchecked',
    });
  }
  return result;
}
