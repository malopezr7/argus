import { accessSync, constants, existsSync } from 'node:fs';
import type { EngineTarget, HermesBinary, HermesProvisioner } from '@argus/core';
import { detectArch, readHermesVersionInfo } from './utils.js';

/**
 * LocalPathAdapter (BYO) — resolves a user-supplied `hermes` binary.
 * Use cases: CI cache, monorepo-vendored binary, the Phase 0/1 spike binary.
 */
export class LocalPathAdapter implements HermesProvisioner {
  constructor(private readonly binaryPath: string) {}

  async resolve(_target: EngineTarget): Promise<HermesBinary> {
    if (!this.binaryPath || !existsSync(this.binaryPath)) {
      throw new Error(
        `LocalPathAdapter: hermes binary not found at "${this.binaryPath}". ` +
          'Set ARGUS_HERMES or pass an explicit path.',
      );
    }
    accessSync(this.binaryPath, constants.X_OK);
    // A BYO binary is the one case where nothing pinned it, so its self-report
    // is the only evidence of which engine the user actually handed us. One read
    // serves both the legacy `version` field and the structured info.
    const info = readHermesVersionInfo(this.binaryPath);
    return {
      path: this.binaryPath,
      version: info.releaseVersion ?? 'unknown',
      arch: detectArch(this.binaryPath),
      ...info,
    };
  }
}
