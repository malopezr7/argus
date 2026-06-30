import type { EngineTarget, HermesBinary, HermesProvisioner } from '@argus/core';

/**
 * PrebuiltAdapter (default) — downloads a prebuilt hermes binary from Argus CI
 * artifact storage for the detected target. Signature/checksum-verified;
 * quarantine-stripped on macOS. TODO (Phase 2).
 */
export class PrebuiltAdapter implements HermesProvisioner {
  async resolve(_target: EngineTarget): Promise<HermesBinary> {
    throw new Error('NotImplemented: PrebuiltAdapter.resolve — Phase 2');
  }
}
