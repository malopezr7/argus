/**
 * Core domain types for Argus.
 *
 * These types cross the two-process boundary:
 *   HOST (Node/Bun) -- bundle --> HERMES -- framed JSON stdout --> HOST
 *
 * No runtime-specific imports allowed here.
 */

import type { HermesEngine } from './hermes-version.js';

// ---------------------------------------------------------------------------
// Transform pipeline
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bundle pipeline
// ---------------------------------------------------------------------------

/**
 * Input to a bundle operation.
 *
 * The bundler generates a synthetic VIRTUAL ENTRY (NOT a user file) that:
 *   1. evaluates the env polyfills (build `global`, `console` from `print`),
 *   2. imports the in-Hermes framework (registers describe/test/expect),
 *   3. imports every user test file (which register their suites/tests),
 *   4. calls the framework's run(), which prints the framed result line.
 * esbuild then bundles that entry into one sealed IIFE.
 *
 * (esbuild `inject` is NOT a "prepend-and-execute" mechanism — the entry must
 * be generated.)
 */
export interface BundleInput {
  /** Absolute paths to the user test files to include and execute. */
  testPaths: string[];
  /** Absolute path to the in-Hermes framework module (describe/test/expect/run). */
  frameworkPath: string;
  /** Absolute path to the component-testing facade exposed through the `argus` alias. */
  componentPath: string;
  /** Absolute paths to env polyfill modules, evaluated before anything else. */
  polyfillPaths: string[];
  /**
   * Which Hermes engine will run this bundle — the engine of the binary that
   * was actually provisioned, not the one the project nominally targets.
   *
   * It decides the esbuild target and whether classes are lowered, so getting
   * it from a constant rather than from the resolved engine is what let `class`
   * in a user's own test file reach a VM that cannot parse it.
   */
  engine: HermesEngine;
  /**
   * Root of the project under test — where packages the project OWNS (React) are
   * resolved from, so the bundle is built against the same React the user's
   * components are written against rather than a copy shipped alongside Argus.
   *
   * Optional: absent means the bundler falls back to the working directory.
   */
  projectDir?: string;
}

/**
 * A fully sealed, self-contained bundle ready to hand to the Hermes engine.
 * Format is always IIFE so Hermes can run it without a module resolver.
 */
export interface SealedBundle {
  /**
   * The bundle as a UTF-8 string.
   * Contains: [env polyfills] + [micro-framework] + [user code] + [virtual entry].
   */
  code: string;
  /** Inline or external source map, if generated. */
  map?: string;
  /** Size of the bundle in bytes (informational). */
  sizeBytes: number;
  /**
   * Random per-bundle nonce. The bundler inlines it as a PRIVATE argument to
   * run(nonce) in the generated virtual entry (NOT a global/`define`), so user
   * code cannot read it. The frame is `__ARGUS_RESULT__:<resultNonce>:<json>`;
   * the host parser accepts only frames bearing this nonce.
   */
  resultNonce: string;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Identifies which Hermes binary to use.
 *
 * TODO: the real provisioning cache key is finer than this — it also needs the
 * exact Hermes tag/version, libc (glibc vs musl on Linux), and build config/ABI.
 * Deferred.
 */
export interface EngineTarget {
  /** React Native version string, e.g. '0.86.0'. */
  rnVersion: string;
  /** Operating system identifier. */
  os: 'darwin' | 'linux' | 'win32';
  /** CPU architecture. */
  arch: 'arm64' | 'x64';
  /** Exact Hermes version/tag this RN pins (from .hermesv1version). */
  hermesVersion?: string;
}

/** A resolved Hermes binary on disk. */
export interface HermesBinary {
  /** Absolute path to the `hermes` executable. */
  path: string;
  /** Hermes version string, e.g. '0.13.0'. */
  version: string;
  /** Architecture this binary was compiled for. */
  arch: 'arm64' | 'x64';
  /**
   * Release version the binary reports via `--version`, e.g. '1.0.0'.
   *
   * Optional because it is only known once the binary has been executed, and a
   * binary that cannot be run or does not report one is still usable.
   */
  releaseVersion?: string;
  /**
   * HBC bytecode version the binary reports: 96 for the legacy engine, 98 for
   * Hermes V1. This is the field to assert engine fidelity against, since the
   * release version alone cannot distinguish the two engines.
   */
  bytecodeVersion?: number;
}

/** Options controlling a single Hermes subprocess invocation. */
export interface EngineRunOptions {
  /** Hard wall-clock limit; the subprocess is killed (SIGKILL) if exceeded. */
  timeoutMs: number;
  /** Working directory for the subprocess. */
  cwd?: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
}

/** Raw output captured from a single Hermes subprocess invocation. */
export interface EngineOutput {
  /** Everything written to stdout (Hermes `print()` calls + framed result). */
  stdout: string;
  /** Everything written to stderr (Hermes diagnostics / errors). */
  stderr: string;
  /** Process exit code (0 = success), or null if killed by a signal. */
  exitCode: number | null;
  /** Terminating signal (e.g. 'SIGKILL'), or null if it exited normally. */
  signal: string | null;
  /** True if the run was killed because it exceeded timeoutMs. */
  timedOut: boolean;
  /** Wall-clock duration of the subprocess in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Result protocol (host <- Hermes)
// ---------------------------------------------------------------------------

/**
 * The framework emits exactly ONE result line on stdout, framed as
 * `__ARGUS_RESULT__:<nonce>:<json-envelope>`. The <nonce> is a per-run secret
 * passed PRIVATELY to run(nonce) (NOT a global/define), so user output cannot
 * forge it. Every OTHER stdout line is user output (console.log → print()).
 * See @arguslab/core's parseHermesOutput for the host-side parsing rules.
 */
export const ARGUS_RESULT_PREFIX = '__ARGUS_RESULT__:';

// ---------------------------------------------------------------------------
// Test result model
// ---------------------------------------------------------------------------

/** A single test case as reported by the in-Hermes micro-framework. */
export interface TestCase {
  /** Fully-qualified test name, e.g. 'math > add > returns the sum'. */
  name: string;
  /** Pass, fail, skip, or todo. */
  status: 'passed' | 'failed' | 'skipped' | 'todo';
  /** Failure message if status is 'failed'. */
  failureMessage?: string;
  /** Raw Error.stack captured inside Hermes (host maps it via source maps later). */
  failureStack?: string;
  /** Duration in milliseconds (measured inside Hermes). */
  durationMs?: number;
}

/** A describe block containing one or more test cases. */
export interface Suite {
  /** Name passed to `describe(...)`. */
  name: string;
  /** Nested suites, if any. */
  suites: Suite[];
  /** Test cases directly inside this suite. */
  tests: TestCase[];
}

/** The test outcome emitted by a framework run that actually executed. */
export interface RunResult {
  /** All top-level suites. */
  suites: Suite[];
  /** Aggregate counts. */
  totals: {
    passed: number;
    failed: number;
    skipped: number;
    todo: number;
    total: number;
  };
  /** Total duration measured inside Hermes. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Execution outcomes (the full result of ATTEMPTING a run)
// ---------------------------------------------------------------------------

/** Stage at which an infrastructure (non-test) failure occurred. */
export type InfraStage = 'discover' | 'transform' | 'bundle' | 'provision' | 'spawn' | 'engine';

/** Why the stdout result protocol could not be honoured. */
export type ProtocolFailureReason = 'missing-frame' | 'multiple-frames' | 'malformed-json';

/**
 * The outcome of attempting a full run. A TEST failure (assertions) is NOT the
 * same as an INFRASTRUCTURE failure (could not even run). The reporter and the
 * process exit code branch on `kind`:
 *   passed                 -> exit 0
 *   failed                 -> exit 1  (tests ran, >= 1 assertion failed)
 *   infrastructure-failure -> exit 2  (could not run)
 *   timeout                -> exit 2
 *   protocol-failure       -> exit 2
 */
export type RunOutcome =
  | { kind: 'passed'; result: RunResult; userLogs: string[] }
  | { kind: 'failed'; result: RunResult; userLogs: string[] }
  | { kind: 'infrastructure-failure'; stage: InfraStage; message: string; detail?: string }
  | { kind: 'timeout'; timeoutMs: number; output: EngineOutput }
  | { kind: 'protocol-failure'; reason: ProtocolFailureReason; rawStdout: string };

// ---------------------------------------------------------------------------
// Session aggregate (host-side, pure — no adapter imports)
// ---------------------------------------------------------------------------

/** The outcome for a single discovered test file. Pure domain type. */
export interface FileResult {
  /** Absolute path of the test file. */
  file: string;
  /** The run outcome for this file. */
  outcome: RunOutcome;
}

/**
 * Aggregate result for a multi-file CLI session.
 * Produced by folding FileResult[] after the per-file run loop.
 * Pure domain type — no adapter or I/O imports allowed here.
 */
export interface SessionResult {
  /** Per-file results in discovery order. */
  files: FileResult[];
  /**
   * Rolled-up counts across all files. Infra/timeout/protocol files are
   * NOT counted in passed/failed — only `kind: 'passed'` and `kind: 'failed'`.
   */
  totals: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  };
}
