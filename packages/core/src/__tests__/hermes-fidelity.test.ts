import { describe, expect, it } from 'vitest';
import {
  checkEngineFidelity,
  EXPECTED_BYTECODE_VERSION,
  engineForBytecodeVersion,
} from '../domain/hermes-fidelity.js';

describe('EXPECTED_BYTECODE_VERSION', () => {
  it('maps legacy to 96 and v1 to 98', () => {
    expect(EXPECTED_BYTECODE_VERSION).toEqual({ legacy: 96, v1: 98 });
  });
});

describe('engineForBytecodeVersion', () => {
  it('identifies the legacy engine from 96', () => {
    expect(engineForBytecodeVersion(96)).toBe('legacy');
  });

  it('identifies Hermes V1 from 98', () => {
    expect(engineForBytecodeVersion(98)).toBe('v1');
  });

  it('refuses to guess for an unknown bytecode version', () => {
    expect(engineForBytecodeVersion(99)).toBeUndefined();
    expect(engineForBytecodeVersion(0)).toBeUndefined();
  });
});

describe('checkEngineFidelity', () => {
  it('accepts a legacy binary for a legacy target', () => {
    expect(checkEngineFidelity('legacy', { bytecodeVersion: 96 })).toEqual({
      kind: 'ok',
      engine: 'legacy',
      bytecodeVersion: 96,
    });
  });

  it('accepts a V1 binary for a V1 target', () => {
    expect(checkEngineFidelity('v1', { bytecodeVersion: 98 })).toEqual({
      kind: 'ok',
      engine: 'v1',
      bytecodeVersion: 98,
    });
  });

  it('flags a legacy binary handed to a V1 target', () => {
    expect(checkEngineFidelity('v1', { bytecodeVersion: 96 })).toEqual({
      kind: 'mismatch',
      expected: 'v1',
      expectedBytecodeVersion: 98,
      actualBytecodeVersion: 96,
      actualEngine: 'legacy',
    });
  });

  it('flags a V1 binary handed to a legacy target', () => {
    expect(checkEngineFidelity('legacy', { bytecodeVersion: 98 })).toEqual({
      kind: 'mismatch',
      expected: 'legacy',
      expectedBytecodeVersion: 96,
      actualBytecodeVersion: 98,
      actualEngine: 'v1',
    });
  });

  it('reports a mismatch without naming an engine it cannot identify', () => {
    const fidelity = checkEngineFidelity('v1', { bytecodeVersion: 120 });

    expect(fidelity).toEqual({
      kind: 'mismatch',
      expected: 'v1',
      expectedBytecodeVersion: 98,
      actualBytecodeVersion: 120,
    });
    expect(fidelity.kind === 'mismatch' && 'actualEngine' in fidelity).toBe(false);
  });

  it('stays silent when the binary reports no bytecode version', () => {
    expect(checkEngineFidelity('v1', {})).toEqual({ kind: 'unknown' });
    expect(checkEngineFidelity('v1', { releaseVersion: '1.0.0' })).toEqual({ kind: 'unknown' });
  });

  it('stays silent when the project targets no engine at all', () => {
    expect(checkEngineFidelity(undefined, { bytecodeVersion: 96 })).toEqual({ kind: 'unknown' });
  });
});
