import { describe, expect, it } from 'vitest';
import {
  buildCmakeBuildArgs,
  buildCmakeConfigureArgs,
  HERMES_BUILD_TARGETS,
} from '../domain/hermes-build-config.js';

const SRC = '/cache/hermes-src';
const BUILD = '/cache/build';

describe('buildCmakeConfigureArgs', () => {
  it('produces the full React Native flag set on darwin', () => {
    expect(
      buildCmakeConfigureArgs({
        sourceDir: SRC,
        buildDir: BUILD,
        platform: 'darwin',
        releaseVersion: '0.17.0',
      }),
    ).toEqual([
      '-S',
      SRC,
      '-B',
      BUILD,
      '-G',
      'Ninja',
      '-DCMAKE_BUILD_TYPE=Release',
      '-DHERMES_ENABLE_INTL=ON',
      '-DHERMES_ENABLE_DEBUGGER=ON',
      '-DHERMES_ENABLE_TEST_SUITE=OFF',
      '-DCMAKE_OSX_ARCHITECTURES=x86_64;arm64',
      '-DHERMES_RELEASE_VERSION=0.17.0',
    ]);
  });

  it('produces the same flag set minus the universal binary on linux', () => {
    expect(
      buildCmakeConfigureArgs({
        sourceDir: SRC,
        buildDir: BUILD,
        platform: 'linux',
        releaseVersion: '250829098.0.16',
      }),
    ).toEqual([
      '-S',
      SRC,
      '-B',
      BUILD,
      '-G',
      'Ninja',
      '-DCMAKE_BUILD_TYPE=Release',
      '-DHERMES_ENABLE_INTL=ON',
      '-DHERMES_ENABLE_DEBUGGER=ON',
      '-DHERMES_ENABLE_TEST_SUITE=OFF',
      '-DHERMES_RELEASE_VERSION=250829098.0.16',
    ]);
  });

  it('emits CMAKE_OSX_ARCHITECTURES only on darwin', () => {
    const onDarwin = buildCmakeConfigureArgs({
      sourceDir: SRC,
      buildDir: BUILD,
      platform: 'darwin',
    });
    expect(onDarwin).toContain('-DCMAKE_OSX_ARCHITECTURES=x86_64;arm64');

    for (const platform of ['linux', 'win32', 'freebsd'] as const) {
      const args = buildCmakeConfigureArgs({ sourceDir: SRC, buildDir: BUILD, platform });
      expect(args.some((a) => a.startsWith('-DCMAKE_OSX_ARCHITECTURES'))).toBe(false);
    }
  });

  it.each([
    '-DCMAKE_BUILD_TYPE=Release',
    '-DHERMES_ENABLE_INTL=ON',
    '-DHERMES_ENABLE_DEBUGGER=ON',
    '-DHERMES_ENABLE_TEST_SUITE=OFF',
  ])('always passes %s', (flag) => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(buildCmakeConfigureArgs({ sourceDir: SRC, buildDir: BUILD, platform })).toContain(
        flag,
      );
    }
  });

  it('omits the release version flag when the ref carries none', () => {
    const args = buildCmakeConfigureArgs({ sourceDir: SRC, buildDir: BUILD, platform: 'darwin' });
    expect(args.some((a) => a.startsWith('-DHERMES_RELEASE_VERSION'))).toBe(false);
  });

  it('omits the release version flag for a blank value', () => {
    const args = buildCmakeConfigureArgs({
      sourceDir: SRC,
      buildDir: BUILD,
      platform: 'linux',
      releaseVersion: '   ',
    });
    expect(args.some((a) => a.startsWith('-DHERMES_RELEASE_VERSION'))).toBe(false);
  });
});

describe('buildCmakeBuildArgs', () => {
  it('builds the VM, the compiler, and the bytecode runner in one invocation', () => {
    expect(buildCmakeBuildArgs({ buildDir: BUILD, parallelism: 10 })).toEqual([
      '--build',
      BUILD,
      '--target',
      'hermes',
      'hermesc',
      'hvm',
      '-j',
      '10',
    ]);
  });

  it('exposes the same targets it defaults to', () => {
    expect(HERMES_BUILD_TARGETS).toEqual(['hermes', 'hermesc', 'hvm']);
  });

  it('accepts an explicit target list', () => {
    expect(buildCmakeBuildArgs({ buildDir: BUILD, parallelism: 1, targets: ['hermes'] })).toEqual([
      '--build',
      BUILD,
      '--target',
      'hermes',
      '-j',
      '1',
    ]);
  });

  it.each([
    [0, '1'],
    [-4, '1'],
    [Number.NaN, '1'],
    [Number.POSITIVE_INFINITY, '1'],
    [7.9, '7'],
  ])('clamps parallelism %p to %s', (parallelism, expected) => {
    const args = buildCmakeBuildArgs({ buildDir: BUILD, parallelism });
    expect(args[args.length - 1]).toBe(expected);
  });
});
