/**
 * Equality matcher tests — task 5.3
 * AC-01..07, AC-23, AC-24
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('toBe', () => {
  it('passes for same primitive (AC-07)', () => {
    argusExpect(42).toBe(42);
  });

  it('throws for different primitives', () => {
    expect(() => argusExpect(42).toBe(43)).toThrow();
  });

  it('passes for NaN === NaN (AC-07)', () => {
    argusExpect(NaN).toBe(NaN);
  });

  it('throws for +0 vs -0 (AC-07)', () => {
    expect(() => argusExpect(+0).toBe(-0)).toThrow();
  });

  it('.not.toBe: throws when actual IS expected (AC-23)', () => {
    expect(() => argusExpect(5).not.toBe(5)).toThrow();
  });

  it('.not.toBe: passes when actual is NOT expected (AC-23)', () => {
    argusExpect(5).not.toBe(6);
  });
});

describe('toEqual', () => {
  it('passes for structurally equal objects (AC-01)', () => {
    argusExpect({ a: 1 }).toEqual({ a: 1 });
  });

  it('throws for structurally different objects (AC-01)', () => {
    expect(() => argusExpect({ a: 1 }).toEqual({ a: 2 })).toThrow();
  });

  it('treats {a:1} equal to {a:1, b:undefined} (AC-02)', () => {
    argusExpect({ a: 1 }).toEqual({ a: 1, b: undefined });
  });

  it('compares arrays by elements', () => {
    argusExpect([1, 2, 3]).toEqual([1, 2, 3]);
  });

  it('throws for arrays with different elements', () => {
    expect(() => argusExpect([1, 2]).toEqual([1, 3])).toThrow();
  });

  it('.not.toEqual: passes when not structurally equal (AC-24)', () => {
    argusExpect({ a: 1 }).not.toEqual({ a: 2 });
  });

  it('.not.toEqual: throws when structurally equal (AC-24)', () => {
    expect(() => argusExpect({ a: 1 }).not.toEqual({ a: 1 })).toThrow();
  });
});

describe('toStrictEqual', () => {
  it('passes for strictly equal objects', () => {
    argusExpect({ a: 1 }).toStrictEqual({ a: 1 });
  });

  it('throws for {a:1} vs {a:1, b:undefined} in strict mode (AC-03)', () => {
    expect(() => argusExpect({ a: 1 }).toStrictEqual({ a: 1, b: undefined })).toThrow();
  });

  it('throws for sparse hole vs undefined element (AC-04)', () => {
    // biome-ignore lint: sparse array intentional for testing hole vs undefined semantics
    expect(() => argusExpect([1, , 3]).toStrictEqual([1, undefined, 3])).toThrow();
  });

  it('throws for {} vs [] (AC-05)', () => {
    expect(() => argusExpect({}).toStrictEqual([])).toThrow();
  });

  it('.not.toStrictEqual: passes when not strictly equal', () => {
    argusExpect({ a: 1 }).not.toStrictEqual({ a: 2 });
  });
});
