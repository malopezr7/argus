/**
 * Equality matchers: toBe (Object.is), toEqual (loose structural) and
 * toStrictEqual (strict structural), plus their .not forms.
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('toBe', () => {
  it('passes for same primitive', () => {
    argusExpect(42).toBe(42);
  });

  it('throws for different primitives', () => {
    expect(() => argusExpect(42).toBe(43)).toThrow();
  });

  it('passes for NaN === NaN', () => {
    argusExpect(NaN).toBe(NaN);
  });

  it('throws for +0 vs -0', () => {
    expect(() => argusExpect(+0).toBe(-0)).toThrow();
  });

  it('.not.toBe: throws when actual IS expected', () => {
    expect(() => argusExpect(5).not.toBe(5)).toThrow();
  });

  it('.not.toBe: passes when actual is NOT expected', () => {
    argusExpect(5).not.toBe(6);
  });
});

describe('toEqual', () => {
  it('passes for structurally equal objects', () => {
    argusExpect({ a: 1 }).toEqual({ a: 1 });
  });

  it('throws for structurally different objects', () => {
    expect(() => argusExpect({ a: 1 }).toEqual({ a: 2 })).toThrow();
  });

  it('treats {a:1} equal to {a:1, b:undefined}', () => {
    argusExpect({ a: 1 }).toEqual({ a: 1, b: undefined });
  });

  it('compares arrays by elements', () => {
    argusExpect([1, 2, 3]).toEqual([1, 2, 3]);
  });

  it('throws for arrays with different elements', () => {
    expect(() => argusExpect([1, 2]).toEqual([1, 3])).toThrow();
  });

  it('.not.toEqual: passes when not structurally equal', () => {
    argusExpect({ a: 1 }).not.toEqual({ a: 2 });
  });

  it('.not.toEqual: throws when structurally equal', () => {
    expect(() => argusExpect({ a: 1 }).not.toEqual({ a: 1 })).toThrow();
  });
});

describe('toStrictEqual', () => {
  it('passes for strictly equal objects', () => {
    argusExpect({ a: 1 }).toStrictEqual({ a: 1 });
  });

  it('throws for {a:1} vs {a:1, b:undefined} in strict mode', () => {
    expect(() => argusExpect({ a: 1 }).toStrictEqual({ a: 1, b: undefined })).toThrow();
  });

  it('throws for sparse hole vs undefined element', () => {
    // biome-ignore lint: sparse array intentional for testing hole vs undefined semantics
    expect(() => argusExpect([1, , 3]).toStrictEqual([1, undefined, 3])).toThrow();
  });

  it('throws for {} vs []', () => {
    expect(() => argusExpect({}).toStrictEqual([])).toThrow();
  });

  it('.not.toStrictEqual: passes when not strictly equal', () => {
    argusExpect({ a: 1 }).not.toStrictEqual({ a: 2 });
  });
});
