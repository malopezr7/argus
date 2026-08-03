import type { EngineTarget, HermesBinary } from '../domain/types.js';

/**
 * Port: HermesProvisioner
 *
 * Resolves (and if necessary downloads or builds) the Hermes VM binary for a
 * given target triple (RN version × OS × arch).
 *
 * Three adapters are planned:
 *  - PrebuiltAdapter  — downloads a prebuilt binary from Argus CI artifacts.
 *  - SourceBuildAdapter — builds from facebook/hermes source at the pinned commit.
 *  - LocalPathAdapter — points to a user-supplied binary (BYO / CI cache).
 */
export interface HermesProvisioner {
  /**
   * Resolve a Hermes binary for the given target.
   *
   * The adapter is responsible for caching (e.g. ~/.argus/bin/), integrity
   * verification (checksums), and platform-specific setup (e.g. macOS
   * quarantine removal via `xattr -d com.apple.quarantine`).
   *
   * @param target - RN version, OS, and CPU architecture to target.
   * @returns A promise resolving to a usable Hermes binary descriptor.
   */
  resolve(target: EngineTarget): Promise<HermesBinary>;
}
