import type {
  EngineOutput,
  EngineRunOptions,
  HermesBinary,
  SealedBundle,
} from '../domain/types.js';

/**
 * Port: Engine
 *
 * Executes ONE sealed bundle on a Hermes binary subprocess.
 *
 * The channel is strictly unidirectional:
 *   bundle → temp file → Hermes → stdout (framed JSON) → host
 *
 * The adapter is responsible for:
 *  - Spawning the `hermes` subprocess (not `hermesc` or `hvm`).
 *  - Writing the bundle to a TEMP FILE and passing it as the path argument.
 *    NOT stdin: piping puts Hermes in REPL mode, which pollutes stdout with
 *    `>> ` prompts and `undefined` lines (observed against the real binary).
 *  - Capturing stdout and stderr completely.
 *  - Enforcing opts.timeoutMs: kill the subprocess (SIGKILL) if exceeded and
 *    set EngineOutput.timedOut. A hanging test must never hang the runner.
 *  - Cleaning up any temp file it created.
 *  - Measuring wall-clock duration.
 *  - Never injecting anything into the bundle at execution time
 *    (all injection happens at bundle time).
 */
export interface Engine {
  /**
   * Execute a sealed bundle on the given Hermes binary.
   *
   * @param bundle - The sealed IIFE bundle to execute.
   * @param bin    - The Hermes binary to use.
   * @param opts   - Timeout / cwd / env for the subprocess.
   * @returns Raw stdout/stderr/exit/signal/timedOut/duration.
   */
  run(bundle: SealedBundle, bin: HermesBinary, opts: EngineRunOptions): Promise<EngineOutput>;
}
