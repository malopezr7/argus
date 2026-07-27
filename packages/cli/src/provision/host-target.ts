import type { EngineTarget } from '@argus/core';

/** The subset of `process` this module reads, injected so it is testable. */
export interface HostInfo {
  /** `process.platform`. */
  platform: string;
  /** `process.arch`. */
  arch: string;
  /** React Native version detected in the project, when known. */
  rnVersion?: string;
  /** Hermes tag the project pins, when known. */
  hermesVersion?: string;
}

/**
 * Placeholder React Native version for a project with no detectable install.
 *
 * `EngineTarget.rnVersion` is required, but a host running Argus against plain
 * TypeScript has no React Native to report. A sentinel keeps the type honest
 * about the value being absent; nothing downstream parses it.
 */
export const UNKNOWN_RN_VERSION = 'unknown';

/**
 * Map `process.platform` onto the OS values `EngineTarget` models.
 *
 * Everything that is neither macOS nor Windows is treated as Linux. That is an
 * approximation for the remaining POSIX platforms Node runs on (freebsd,
 * openbsd, sunos, aix, android), chosen deliberately over throwing: `os` is
 * informational — no provisioning source branches on it — and refusing to start
 * on an unusual host would block the one path that would still have worked
 * there, a user-supplied binary via `--hermes`.
 */
export function toHostOs(platform: string): EngineTarget['os'] {
  if (platform === 'darwin') return 'darwin';
  if (platform === 'win32') return 'win32';
  return 'linux';
}

/**
 * Map `process.arch` onto the architectures `EngineTarget` models.
 *
 * Mirrors the coarse fallback in the Hermes adapter's `detectArch`: anything
 * that is not arm64 is reported as x64.
 */
export function toHostArch(arch: string): EngineTarget['arch'] {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * Build the engine target for the machine Argus is running on.
 *
 * Replaces the hardcoded `{ rnVersion: '0.86.0', os: 'darwin', arch: 'arm64' }`
 * that was correct only on the machine it was written on. The React Native
 * version is not detected here — it comes from the engine resolver, which
 * already walks up to the install to read its pins.
 */
export function detectHostTarget(host: HostInfo): EngineTarget {
  return {
    rnVersion: host.rnVersion ?? UNKNOWN_RN_VERSION,
    os: toHostOs(host.platform),
    arch: toHostArch(host.arch),
    ...(host.hermesVersion === undefined ? {} : { hermesVersion: host.hermesVersion }),
  };
}
