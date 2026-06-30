import { accessSync, constants, existsSync } from 'node:fs';
import type { EngineTarget, HermesBinary, HermesProvisioner } from '@argus/core';
import { detectArch, detectVersion } from './utils.js';

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
    return {
      path: this.binaryPath,
      version: detectVersion(this.binaryPath),
      arch: detectArch(this.binaryPath),
    };
  }
}
