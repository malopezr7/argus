/**
 * deepEqual edge-case matrix — primitives, sparse arrays, undefined properties,
 * cycles, Date/RegExp, class instances, and the Map/Set guard, in both the
 * loose (toEqual) and strict (toStrictEqual) modes.
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('deepEqual edge-case matrix', () => {
  // --- Leaf / primitive ---

  it('NaN equals NaN (Object.is leaf)', () => {
    argusExpect(NaN).toEqual(NaN);
  });

  it('+0 and -0 are NOT equal (Object.is)', () => {
    expect(() => argusExpect(+0).toEqual(-0)).toThrow();
  });

  it('+0 and -0 are NOT equal via toBe', () => {
    expect(() => argusExpect(+0).toBe(-0)).toThrow();
  });

  it('NaN equals NaN via toBe', () => {
    argusExpect(NaN).toBe(NaN);
  });

  // --- Sparse array ---

  it('loose: sparse hole [1,,3] equals [1,undefined,3]', () => {
    // biome-ignore lint: sparse array intentional for testing hole vs undefined semantics
    argusExpect([1, , 3]).toEqual([1, undefined, 3]);
  });

  it('strict: sparse hole [1,,3] does NOT equal [1,undefined,3]', () => {
    // biome-ignore lint: sparse array intentional for testing hole vs undefined semantics
    expect(() => argusExpect([1, , 3]).toStrictEqual([1, undefined, 3])).toThrow();
  });

  // --- {} vs [] ---

  it('toStrictEqual: {} is NOT equal to []', () => {
    expect(() => argusExpect({}).toStrictEqual([])).toThrow();
  });

  it('toEqual: {} is NOT equal to [] (different lengths/keys)', () => {
    expect(() => argusExpect({}).toEqual([])).toThrow();
  });

  // --- undefined prop (loose vs strict) ---

  it('loose: {a:1} equals {a:1, b:undefined}', () => {
    argusExpect({ a: 1 }).toEqual({ a: 1, b: undefined });
  });

  it('strict: {a:1} does NOT equal {a:1, b:undefined}', () => {
    expect(() => argusExpect({ a: 1 }).toStrictEqual({ a: 1, b: undefined })).toThrow();
  });

  // --- Cycle: symmetric (self-referential, equal) ---

  it('self-referential objects terminate and compare equal', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    argusExpect(a).toEqual(b);
  });

  // --- Cycle: asymmetric — NOT equal ---

  it('asymmetric cycle: a cycles, b does not — NOT equal', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = { self: { self: null } };
    expect(() => argusExpect(a).toEqual(b)).toThrow();
  });

  // --- Date equality ---

  it('two Date(NaN) are NOT equal', () => {
    expect(() => argusExpect(new Date(NaN)).toEqual(new Date(NaN))).toThrow();
  });

  it('two valid Dates with same timestamp are equal', () => {
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

  it('strict: two class instances with same fields are NOT equal', () => {
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

  // --- Map/Set loud guard ---

  it('Map/Set guard: toEqual on two Maps throws', () => {
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
