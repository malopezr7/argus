import { describe, expect, it } from 'vitest';
import {
  detectHostTarget,
  toHostArch,
  toHostOs,
  UNKNOWN_RN_VERSION,
} from '../provision/host-target.js';

describe('toHostOs', () => {
  it('maps the three platforms EngineTarget models', () => {
    expect(toHostOs('darwin')).toBe('darwin');
    expect(toHostOs('linux')).toBe('linux');
    expect(toHostOs('win32')).toBe('win32');
  });

  it('treats other POSIX platforms as linux', () => {
    expect(toHostOs('freebsd')).toBe('linux');
    expect(toHostOs('android')).toBe('linux');
  });
});

describe('toHostArch', () => {
  it('distinguishes arm64 from everything else', () => {
    expect(toHostArch('arm64')).toBe('arm64');
    expect(toHostArch('x64')).toBe('x64');
    expect(toHostArch('ppc64')).toBe('x64');
  });
});

describe('detectHostTarget', () => {
  it('reports the real host instead of a hardcoded one', () => {
    expect(detectHostTarget({ platform: 'linux', arch: 'x64', rnVersion: '0.82.1' })).toEqual({
      rnVersion: '0.82.1',
      os: 'linux',
      arch: 'x64',
    });
  });

  it('carries the pinned Hermes tag when one is known', () => {
    expect(
      detectHostTarget({
        platform: 'darwin',
        arch: 'arm64',
        rnVersion: '0.86.2',
        hermesVersion: 'hermes-v250829098.0.16',
      }),
    ).toEqual({
      rnVersion: '0.86.2',
      os: 'darwin',
      arch: 'arm64',
      hermesVersion: 'hermes-v250829098.0.16',
    });
  });

  it('marks the React Native version unknown rather than inventing one', () => {
    expect(detectHostTarget({ platform: 'darwin', arch: 'arm64' }).rnVersion).toBe(
      UNKNOWN_RN_VERSION,
    );
  });

  it('matches this machine when handed the live process values', () => {
    const target = detectHostTarget({ platform: process.platform, arch: process.arch });

    expect(['darwin', 'linux', 'win32']).toContain(target.os);
    expect(['arm64', 'x64']).toContain(target.arch);
  });
});
