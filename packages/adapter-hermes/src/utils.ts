import { execFileSync } from 'node:child_process';
import { type HermesVersionInfo, parseHermesVersionOutput } from '@argus/core';

/** Wall-clock cap so a hung or non-Hermes binary cannot stall provisioning. */
const VERSION_TIMEOUT_MS = 10_000;

/**
 * Read and parse `<binPath> --version`.
 *
 * Anything that goes wrong — the file is not executable, it exits non-zero, it
 * hangs, it prints something unrecognisable — yields an empty result. 'Version
 * unknown' is a normal answer here: provisioning succeeds either way, and the
 * caller decides whether a missing bytecode version is worth complaining about.
 */
export function readHermesVersionInfo(binPath: string): HermesVersionInfo {
  try {
    const out = execFileSync(binPath, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: VERSION_TIMEOUT_MS,
    });
    return parseHermesVersionOutput(out);
  } catch {
    return {};
  }
}

/**
 * Hermes release version of a binary, or 'unknown'.
 *
 * `--version` opens with an LLVM preamble whose own version line precedes the
 * Hermes one, so this delegates to the structured parser rather than matching
 * the first version-shaped token it sees.
 */
export function detectVersion(binPath: string): string {
  return readHermesVersionInfo(binPath).releaseVersion ?? 'unknown';
}

export function detectArch(binPath: string): 'arm64' | 'x64' {
  try {
    const out = execFileSync('file', [binPath], { encoding: 'utf8' });
    const hasArm = /arm64/.test(out);
    const hasX64 = /x86_64/.test(out);
    if (hasArm && !hasX64) return 'arm64';
    if (hasX64 && !hasArm) return 'x64';
  } catch {
    // fall through to host arch
  }
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}
