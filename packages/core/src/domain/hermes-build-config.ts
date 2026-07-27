/**
 * Hermes source-build configuration — PURE. Produces the argument vectors for
 * the cmake configure and build steps; actually running them is the adapter's
 * job (see `@argus/hermes`).
 *
 * The flag set mirrors what React Native builds Hermes with (its
 * `utils/build-apple-framework.sh`), so a VM that Argus builds behaves like the
 * engine a real release ships rather than like a default clone:
 *
 *  - `HERMES_ENABLE_INTL=ON`       — `Intl` is a BUILD flag, not an engine
 *    capability. A VM built without it silently lacks `Intl` while the engine
 *    the app ships has it, which is exactly the fidelity gap Argus exists to
 *    close.
 *  - `HERMES_ENABLE_DEBUGGER=ON`   — matches RN's own builds.
 *  - `HERMES_ENABLE_TEST_SUITE=OFF` — the Hermes test suite is not ours to
 *    build, and it is the single biggest cost in a default configure.
 *  - `CMAKE_OSX_ARCHITECTURES`     — universal binary on macOS, as RN does.
 */

/**
 * Targets to build.
 *
 * `hermesc` and `hvm` are built alongside `hermes` because compiling once to
 * bytecode (`hermesc -emit-binary -out f.hbc f.js`) and running that with `hvm`
 * is several times faster on re-runs than re-parsing the source every time.
 * Argus does not take that path yet, but the binaries must exist before it can.
 */
export const HERMES_BUILD_TARGETS: readonly string[] = ['hermes', 'hermesc', 'hvm'];

/** Slices for the macOS universal binary, matching React Native's build. */
const MACOS_ARCHITECTURES = 'x86_64;arm64';

/** Inputs for the cmake configure step. */
export interface CmakeConfigureOptions {
  /** Directory holding the facebook/hermes checkout. */
  sourceDir: string;
  /** Directory cmake should generate the build tree into. */
  buildDir: string;
  /**
   * Host platform, in `process.platform` terms. Passed in rather than read from
   * `process` so this stays pure and both platforms are testable from either.
   * Only `'darwin'` changes the result.
   */
  platform: NodeJS.Platform;
  /**
   * Bare release version to bake in, e.g. '0.17.0'. Omit when the ref carries
   * none — see `releaseVersionForRef` in `hermes-version.ts`.
   */
  releaseVersion?: string;
}

/** Build the argv for the `cmake` configure step. */
export function buildCmakeConfigureArgs(options: CmakeConfigureOptions): string[] {
  const args = [
    '-S',
    options.sourceDir,
    '-B',
    options.buildDir,
    '-G',
    'Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DHERMES_ENABLE_INTL=ON',
    '-DHERMES_ENABLE_DEBUGGER=ON',
    '-DHERMES_ENABLE_TEST_SUITE=OFF',
  ];

  // A universal binary is a macOS concept; the flag is meaningless elsewhere.
  if (options.platform === 'darwin') {
    args.push(`-DCMAKE_OSX_ARCHITECTURES=${MACOS_ARCHITECTURES}`);
  }

  const releaseVersion = options.releaseVersion?.trim();
  if (releaseVersion !== undefined && releaseVersion.length > 0) {
    args.push(`-DHERMES_RELEASE_VERSION=${releaseVersion}`);
  }

  return args;
}

/** Inputs for the cmake build step. */
export interface CmakeBuildOptions {
  /** Directory the configure step generated into. */
  buildDir: string;
  /** Max parallel compile jobs. Non-finite or sub-1 values are clamped to 1. */
  parallelism: number;
  /** Targets to build. Defaults to `HERMES_BUILD_TARGETS`. */
  targets?: readonly string[];
}

/** Build the argv for `cmake --build`. */
export function buildCmakeBuildArgs(options: CmakeBuildOptions): string[] {
  const targets = options.targets ?? HERMES_BUILD_TARGETS;
  const requested = Math.trunc(options.parallelism);
  const jobs = Number.isFinite(requested) && requested >= 1 ? requested : 1;

  return ['--build', options.buildDir, '--target', ...targets, '-j', String(jobs)];
}
