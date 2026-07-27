// Hermes source-build configuration (pure)
export type {
  CmakeBuildOptions,
  CmakeConfigureOptions,
} from './domain/hermes-build-config.js';
export {
  buildCmakeBuildArgs,
  buildCmakeConfigureArgs,
  HERMES_BUILD_TARGETS,
} from './domain/hermes-build-config.js';
// Hermes engine fidelity (pure)
export type { EngineFidelity } from './domain/hermes-fidelity.js';
export {
  checkEngineFidelity,
  EXPECTED_BYTECODE_VERSION,
  engineForBytecodeVersion,
} from './domain/hermes-fidelity.js';
// Hermes on-disk locations (pure)
export {
  ARGUS_CACHE_SEGMENTS,
  BUNDLED_LEGACY_VM_SEGMENTS,
  hermesCacheBinarySegments,
  hermesCacheRootSegments,
  PROJECT_VENDORED_VM_SEGMENTS,
} from './domain/hermes-locations.js';
// Hermes engine/version domain (pure)
export { HERMES_PINS_BY_RN_MINOR, lookupPinnedRefs, rnMinor } from './domain/hermes-pins.js';
export type {
  EngineResolution,
  EngineSelection,
  HermesEngine,
  HermesPinSource,
  HermesRef,
  HermesVersionInfo,
  PinnedRefs,
} from './domain/hermes-version.js';
export {
  parseHermesTag,
  parseHermesVersionOutput,
  parseVersionProperties,
  releaseVersionForRef,
  selectHermesEngine,
} from './domain/hermes-version.js';
// Domain types
export type {
  BundleInput,
  EngineOutput,
  EngineRunOptions,
  EngineTarget,
  FileResult,
  HermesBinary,
  InfraStage,
  ProtocolFailureReason,
  RunOutcome,
  RunResult,
  SealedBundle,
  SessionResult,
  SourceFile,
  Suite,
  TestCase,
  TransformedCode,
  TransformOptions,
} from './domain/types.js';

// Domain values
export { ARGUS_RESULT_PREFIX } from './domain/types.js';
export type { Bundler } from './ports/Bundler.js';
export type { Engine } from './ports/Engine.js';
export type { HermesProvisioner } from './ports/HermesProvisioner.js';
export type { Reporter } from './ports/Reporter.js';
// Ports
export type { Transformer } from './ports/Transformer.js';
// Result protocol parser (host-side, pure)
export { parseHermesOutput } from './result-protocol.js';
