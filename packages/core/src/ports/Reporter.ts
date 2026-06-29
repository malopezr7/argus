import type { RunOutcome } from '../domain/types.js';

/**
 * Port: Reporter
 *
 * Renders a run OUTCOME to a sink (CLI terminal, TAP stream, JUnit XML, JSON
 * file, etc.). The adapter decides the format and destination.
 *
 * The reporter receives a RunOutcome, NOT a bare RunResult — it must be able to
 * report infrastructure failures, timeouts, and protocol failures, not only
 * test results. Reporters MUST NOT mutate the outcome (read-only consumers).
 */
export interface Reporter {
  /**
   * Render the outcome of a run attempt.
   *
   * @param outcome - passed | failed | infrastructure-failure | timeout | protocol-failure.
   * @returns A promise that resolves when output has been flushed.
   */
  report(outcome: RunOutcome): Promise<void>;
}
