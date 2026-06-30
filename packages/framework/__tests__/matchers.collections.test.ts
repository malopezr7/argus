/**
 * String/collection matcher tests — task 5.6 + 5.6b
 * AC-12..15, AC-37, REQ-04
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('toMatch', () => {
  it('passes for string substring (AC-12)', () => {
    argusExpect('hello world').toMatch('world');
  });

  it('throws when substring not found (AC-12)', () => {
    expect(() => argusExpect('hello world').toMatch('xyz')).toThrow();
  });

  it('passes for matching RegExp (AC-12)', () => {
    argusExpect('hello world').toMatch(/wor.d/);
  });

  it('throws when RegExp does not match (AC-12)', () => {
    expect(() => argusExpect('hello world').toMatch(/^world/)).toThrow();
  });

  it('.not.toMatch: passes when not found', () => {
    argusExpect('hello').not.toMatch('xyz');
  });

  it('.not.toMatch: throws when found', () => {
    expect(() => argusExpect('hello').not.toMatch('hello')).toThrow();
  });
});

describe('toContain', () => {
  it('passes when NaN is in array (SameValueZero, AC-13)', () => {
    argusExpect([1, NaN, 3]).toContain(NaN);
  });

  it('throws when item not in array', () => {
    expect(() => argusExpect([1, 2, 3]).toContain(4)).toThrow();
  });

  it('passes for string substring containment', () => {
    argusExpect('hello world').toContain('world');
  });

  it('passes when +0 contains -0 (SameValueZero, AC-37)', () => {
    // SameValueZero: +0 === -0, so -0 is "in" an array containing +0
    argusExpect([+0]).toContain(-0);
  });

  it('passes when -0 contains +0 (SameValueZero)', () => {
    argusExpect([-0]).toContain(+0);
  });

  it('.not.toContain: passes when item absent', () => {
    argusExpect([1, 2, 3]).not.toContain(99);
  });

  it('.not.toContain: throws when item present', () => {
    expect(() => argusExpect([1, 2]).not.toContain(1)).toThrow();
  });
});

describe('toContainEqual', () => {
  it('passes when array contains structurally equal element (AC-14)', () => {
    argusExpect([{ a: 1 }, { b: 2 }]).toContainEqual({ a: 1 });
  });

  it('throws when no matching element (AC-14)', () => {
    expect(() => argusExpect([{ a: 1 }]).toContainEqual({ a: 2 })).toThrow();
  });

  it('.not.toContainEqual: passes when no match', () => {
    argusExpect([{ a: 1 }]).not.toContainEqual({ a: 99 });
  });

  it('.not.toContainEqual: throws when match found', () => {
    expect(() => argusExpect([{ a: 1 }]).not.toContainEqual({ a: 1 })).toThrow();
  });
});

describe('toHaveLength', () => {
  it('passes for array with correct length (AC-15)', () => {
    argusExpect([1, 2, 3]).toHaveLength(3);
  });

  it('throws for array with wrong length (AC-15)', () => {
    expect(() => argusExpect([1, 2, 3]).toHaveLength(2)).toThrow();
  });

  it('passes for string with correct length', () => {
    argusExpect('hi').toHaveLength(2);
  });

  it('throws for string with wrong length', () => {
    expect(() => argusExpect('hello').toHaveLength(3)).toThrow();
  });

  it('.not.toHaveLength: passes when length differs', () => {
    argusExpect([1, 2]).not.toHaveLength(5);
  });
});
