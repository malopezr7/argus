import type { HermesBinary } from '@arguslab/core';
import { checkEngineFidelity } from '@arguslab/core';
import { describe, expect, it } from 'vitest';
import type { AttemptedSource } from '../provision/chain.js';
import {
  describeSource,
  type EngineContext,
  formatAssumedEngineWarning,
  formatEngineUnavailable,
  formatFidelityWarning,
  formatProvisionFailure,
  formatProvisionSummary,
} from '../provision/messages.js';

const V1_CONTEXT: EngineContext = {
  ref: { engine: 'v1', tag: 'hermes-v250829098.0.16' },
  pinSource: 'version.properties',
  rnVersion: '0.86.2',
  startDir: '/proj',
};

const ATTEMPTED: AttemptedSource[] = [
  { kind: 'cache', path: '/home/dev/.argus/cache/x/build/bin/hermes', reason: 'no cached build' },
  { kind: 'bundled-legacy', reason: 'only ships the legacy VM, but v1 is targeted' },
  { kind: 'prebuilt', reason: 'not implemented yet — no prebuilt binaries are published' },
  { kind: 'source-build', reason: 'not authorised — pass --provision' },
];

function binary(overrides: Partial<HermesBinary> = {}): HermesBinary {
  return { path: '/bin/hermes', version: '1.0.0', arch: 'arm64', ...overrides };
}

describe('formatProvisionFailure', () => {
  const message = formatProvisionFailure(V1_CONTEXT, ATTEMPTED);

  it('names the engine and the resolved tag', () => {
    expect(message).toContain('v1 hermes-v250829098.0.16');
  });

  it('names the file the pin was read from and the React Native version', () => {
    expect(message).toContain('pinned by version.properties');
    expect(message).toContain('react-native 0.86.2');
  });

  it('lists every location it tried, with its reason', () => {
    expect(message).toContain('/home/dev/.argus/cache/x/build/bin/hermes');
    expect(message).toContain('no cached build');
    for (const source of ATTEMPTED) expect(message).toContain(source.kind);
  });

  it('keeps a separator after the widest source name', () => {
    const attempted: AttemptedSource[] = [
      { kind: 'project-vendored', path: '/proj/.hermes/hermes', reason: 'not present' },
      { kind: 'cache', reason: 'no cached build' },
    ];

    const lines = formatProvisionFailure(V1_CONTEXT, attempted).split('\n');

    for (const source of attempted) {
      const line = lines.find((l) => l.trimStart().startsWith(source.kind));
      expect(line).toBeDefined();
      expect(line).toMatch(new RegExp(`${source.kind}\\s{2,}\\S`));
    }
  });

  it('spells out the remedies', () => {
    expect(message).toContain('--provision');
    expect(message).toContain('--hermes <path>');
    expect(message).toContain('ARGUS_HERMES=<path>');
    expect(message).toContain('./.hermes/hermes');
  });

  it('names git, cmake and ninja as the cost of --provision', () => {
    expect(message).toContain('git, cmake, ninja');
  });

  it('does not offer --provision when there is no ref to build', () => {
    const unresolved = formatProvisionFailure(
      { unresolvedReason: 'no-react-native-install', startDir: '/proj' },
      [{ kind: 'cache', reason: 'no engine resolved, so no cache key to look up' }],
    );

    expect(unresolved).toContain('no React Native install found');
    expect(unresolved).toContain('/proj');
    expect(unresolved).toContain('--hermes <path>');
    expect(unresolved).not.toContain('argus --provision [globs...]');
  });

  it('distinguishes an install that pins nothing from a missing install', () => {
    const message = formatProvisionFailure({ unresolvedReason: 'no-pins-found' }, []);

    expect(message).toContain('pins no readable Hermes version');
  });
});

describe('formatProvisionSummary', () => {
  it('records engine, tag, source and path on one line', () => {
    const line = formatProvisionSummary(
      {
        kind: 'cache',
        path: '/home/dev/.argus/cache/h/build/bin/hermes',
        ref: { engine: 'v1', tag: 'hermes-v250829098.0.16', version: '250829098.0.16' },
      },
      V1_CONTEXT,
      binary({ path: '/home/dev/.argus/cache/h/build/bin/hermes' }),
    );

    expect(line).toBe(
      '✓ hermes v1 hermes-v250829098.0.16 · cache · /home/dev/.argus/cache/h/build/bin/hermes\n',
    );
    expect(line.trimEnd().split('\n')).toHaveLength(1);
  });

  it('names the mechanism that supplied an explicit binary', () => {
    expect(
      formatProvisionSummary(
        { kind: 'explicit', origin: 'flag', path: '/bin/hermes' },
        V1_CONTEXT,
        binary(),
      ),
    ).toContain('--hermes');

    expect(
      formatProvisionSummary(
        { kind: 'explicit', origin: 'env', path: '/bin/hermes' },
        V1_CONTEXT,
        binary(),
      ),
    ).toContain('ARGUS_HERMES');
  });

  it('falls back to the binary self-report when the project pins nothing', () => {
    const line = formatProvisionSummary(
      { kind: 'explicit', origin: 'env', path: '/bin/hermes' },
      { unresolvedReason: 'no-react-native-install' },
      binary({ releaseVersion: '0.12.0', bytecodeVersion: 96 }),
    );

    expect(line).toBe('✓ hermes legacy (detected) 0.12.0 · ARGUS_HERMES · /bin/hermes\n');
  });

  it('admits an unknown engine rather than guessing one', () => {
    const line = formatProvisionSummary(
      { kind: 'explicit', origin: 'env', path: '/bin/hermes' },
      {},
      binary({ releaseVersion: undefined }),
    );

    expect(line).toContain('unknown engine');
    expect(line).toContain('unknown version');
  });
});

describe('describeSource', () => {
  it('labels each source kind', () => {
    expect(describeSource({ kind: 'explicit', origin: 'flag', path: '/x' })).toBe('--hermes');
    expect(describeSource({ kind: 'explicit', origin: 'env', path: '/x' })).toBe('ARGUS_HERMES');
    expect(describeSource({ kind: 'project-vendored', path: '/x' })).toBe('project .hermes');
    expect(
      describeSource({
        kind: 'cache',
        path: '/x',
        ref: { engine: 'v1', tag: 't', version: '1' },
      }),
    ).toBe('cache');
    expect(
      describeSource({
        kind: 'source-build',
        ref: { engine: 'v1', tag: 't', version: '1' },
      }),
    ).toBe('source build');
  });
});

describe('formatFidelityWarning', () => {
  it('says nothing when the binary is the targeted engine', () => {
    expect(
      formatFidelityWarning(checkEngineFidelity('v1', { bytecodeVersion: 98 }), binary()),
    ).toBe('');
    expect(
      formatFidelityWarning(checkEngineFidelity('legacy', { bytecodeVersion: 96 }), binary()),
    ).toBe('');
  });

  it('says nothing when the bytecode version is unknown', () => {
    expect(formatFidelityWarning(checkEngineFidelity('v1', {}), binary())).toBe('');
    expect(formatFidelityWarning(checkEngineFidelity(undefined, {}), binary())).toBe('');
  });

  it('warns when a legacy binary is used against a V1 target', () => {
    const warning = formatFidelityWarning(
      checkEngineFidelity('v1', { bytecodeVersion: 96 }),
      binary({ path: '/repo/.hermes/hermes' }),
    );

    expect(warning).toContain('targets v1');
    expect(warning).toContain('bytecode 98');
    expect(warning).toContain('legacy (bytecode 96)');
    expect(warning).toContain('/repo/.hermes/hermes');
    expect(warning).toContain('--engine legacy');
  });

  it('warns when a V1 binary is used against a legacy target', () => {
    const warning = formatFidelityWarning(
      checkEngineFidelity('legacy', { bytecodeVersion: 98 }),
      binary(),
    );

    expect(warning).toContain('targets legacy');
    expect(warning).toContain('v1 (bytecode 98)');
    expect(warning).toContain('--engine v1');
  });

  it('warns without naming an engine it cannot identify', () => {
    const warning = formatFidelityWarning(
      checkEngineFidelity('v1', { bytecodeVersion: 120 }),
      binary(),
    );

    expect(warning).toContain('bytecode 120 (unrecognised engine)');
  });
});

describe('formatAssumedEngineWarning', () => {
  const assumed: EngineContext = {
    ref: { engine: 'v1', tag: 'hermes-v250829098.0.16' },
    pinSource: 'version.properties',
    rnVersion: '0.99.0',
    assumedDefault: true,
    startDir: '/proj',
  };

  it('says nothing when the default engine was known', () => {
    expect(formatAssumedEngineWarning(V1_CONTEXT)).toBe('');
  });

  it('says nothing when no engine was resolved at all', () => {
    expect(formatAssumedEngineWarning({ startDir: '/proj' })).toBe('');
  });

  it('names the assumed engine, the unknown release and the way to settle it', () => {
    const warning = formatAssumedEngineWarning(assumed);

    expect(warning).toContain('v1');
    expect(warning).toContain('0.99.0');
    expect(warning).toContain('--engine');
    expect(warning.endsWith('\n')).toBe(true);
  });

  it('still warns when the release version itself is unknown', () => {
    const warning = formatAssumedEngineWarning({
      ref: { engine: 'v1', tag: 'hermes-v250829098.0.16' },
      assumedDefault: true,
    });

    expect(warning).toContain('--engine');
  });
});

describe('formatEngineUnavailable', () => {
  it('names what the project actually pins', () => {
    expect(formatEngineUnavailable('legacy', ['v1'], '0.87.0')).toBe(
      '--engine legacy is not available: react-native 0.87.0 pins only: v1.',
    );
  });

  it('copes with a project that pins no engine at all', () => {
    expect(formatEngineUnavailable('v1', [])).toContain('no Hermes engine at all');
  });
});
