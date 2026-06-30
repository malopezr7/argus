/**
 * deepEqual edge-case matrix — task 5.1 + 5.1b
 * AC-01..07, AC-40, AC-42, ADR-3, ADR-4
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('deepEqual edge-case matrix', () => {
  // --- Leaf / primitive ---

  it('NaN equals NaN (Object.is leaf, AC-07)', () => {
    argusExpect(NaN).toEqual(NaN);
  });

  it('+0 and -0 are NOT equal (Object.is, AC-07)', () => {
    expect(() => argusExpect(+0).toEqual(-0)).toThrow();
  });

  it('+0 and -0 are NOT equal via toBe', () => {
    expect(() => argusExpect(+0).toBe(-0)).toThrow();
  });

  it('NaN equals NaN via toBe', () => {
    argusExpect(NaN).toBe(NaN);
  });

  // --- Sparse array ---

  it('loose: sparse hole [1,,3] equals [1,undefined,3] (AC-04)', () => {
    // biome-ignore lint: sparse array intentional for testing hole vs undefined semantics
    argusExpect([1, , 3]).toEqual([1, undefined, 3]);
  });

  it('strict: sparse hole [1,,3] does NOT equal [1,undefined,3] (AC-04)', () => {
    // biome-ignore lint: sparse array intentional for testing hole vs undefined semantics
    expect(() => argusExpect([1, , 3]).toStrictEqual([1, undefined, 3])).toThrow();
  });

  // --- {} vs [] ---

  it('toStrictEqual: {} is NOT equal to [] (AC-05)', () => {
    expect(() => argusExpect({}).toStrictEqual([])).toThrow();
  });

  it('toEqual: {} is NOT equal to [] (different lengths/keys)', () => {
    expect(() => argusExpect({}).toEqual([])).toThrow();
  });

  // --- undefined prop (loose vs strict) ---

  it('loose: {a:1} equals {a:1, b:undefined} (AC-02)', () => {
    argusExpect({ a: 1 }).toEqual({ a: 1, b: undefined });
  });

  it('strict: {a:1} does NOT equal {a:1, b:undefined} (AC-03)', () => {
    expect(() => argusExpect({ a: 1 }).toStrictEqual({ a: 1, b: undefined })).toThrow();
  });

  // --- Cycle: symmetric (self-referential, equal) AC-06 ---

  it('self-referential objects terminate and compare equal (AC-06)', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    argusExpect(a).toEqual(b);
  });

  // --- Cycle: asymmetric — NOT equal (AC-42, R2) ---

  it('asymmetric cycle: a cycles, b does not — NOT equal (AC-42)', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = { self: { self: null } };
    expect(() => argusExpect(a).toEqual(b)).toThrow();
  });

  // --- Date equality (AC-40, R4) ---

  it('two Date(NaN) are NOT equal (R4, AC-40)', () => {
    expect(() => argusExpect(new Date(NaN)).toEqual(new Date(NaN))).toThrow();
  });

  it('two valid Dates with same timestamp are equal (AC-40)', () => {
    const ts = 1_700_000_000_000;
    argusExpect(new Date(ts)).toEqual(new Date(ts));
  });

  it('Dates with different timestamps are NOT equal', () => {
    expect(() => argusExpect(new Date(1000)).toEqual(new Date(2000))).toThrow();
  });

  // --- RegExp ---

  it('RegExps with same source+flags are equal', () => {
    argusExpect(/abc/gi).toEqual(/abc/gi);
  });

  it('RegExps with different flags are NOT equal', () => {
    expect(() => argusExpect(/abc/i).toEqual(/abc/g)).toThrow();
  });

  // --- Class instances (strict) ---

  it('strict: two class instances with same fields are NOT equal (AC-05)', () => {
    class Foo {
      x: number;
      constructor(x: number) {
        this.x = x;
      }
    }
    class Bar {
      x: number;
      constructor(x: number) {
        this.x = x;
      }
    }
    expect(() => argusExpect(new Foo(1)).toStrictEqual(new Bar(1))).toThrow();
  });

  it('loose: two class instances with same fields ARE equal (constructor ignored)', () => {
    class Foo {
      x: number;
      constructor(x: number) {
        this.x = x;
      }
    }
    class Bar {
      x: number;
      constructor(x: number) {
        this.x = x;
      }
    }
    argusExpect(new Foo(1)).toEqual(new Bar(1));
  });

  // --- Map/Set loud guard (AC-36, ADR-4) ---

  it('Map/Set guard: toEqual on two Maps throws (AC-36)', () => {
    expect(() => argusExpect(new Map()).toEqual(new Map())).toThrow(
      'Map/Set structural equality is not supported',
    );
  });

  it('Map/Set guard: toEqual on two Sets throws', () => {
    expect(() => argusExpect(new Set()).toEqual(new Set())).toThrow(
      'Map/Set structural equality is not supported',
    );
  });
});
