/**
 * Object matcher tests — task 5.7 + 5.7b
 * AC-16..18, AC-38, REQ-05, R3, R6
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('toHaveProperty', () => {
  it('resolves simple key (AC-16)', () => {
    argusExpect({ a: 1 }).toHaveProperty('a');
  });

  it('resolves dotted path (AC-16)', () => {
    argusExpect({ a: { b: { c: 42 } } }).toHaveProperty('a.b.c');
  });

  it('throws on missing segment (AC-16)', () => {
    expect(() => argusExpect({ a: { b: {} } }).toHaveProperty('a.b.d')).toThrow();
  });

  it('value check: deep equality on resolved value (AC-17)', () => {
    argusExpect({ x: { y: [1, 2, 3] } }).toHaveProperty('x.y', [1, 2, 3]);
  });

  it('value check: throws for wrong value (AC-17)', () => {
    expect(() => argusExpect({ x: { y: [1, 2, 3] } }).toHaveProperty('x.y', [1, 2])).toThrow();
  });

  // R6 / AC-38: omitted vs explicit undefined
  it('passes presence-only for {a:undefined} (AC-38)', () => {
    argusExpect({ a: undefined }).toHaveProperty('a');
  });

  it('passes explicit undefined value for {a:undefined} (AC-38)', () => {
    argusExpect({ a: undefined }).toHaveProperty('a', undefined);
  });

  it('throws explicit undefined value for {a:5} (AC-38)', () => {
    expect(() => argusExpect({ a: 5 }).toHaveProperty('a', undefined)).toThrow();
  });

  it('throws when key is missing (AC-38)', () => {
    expect(() => argusExpect({}).toHaveProperty('a')).toThrow();
  });

  it('.not.toHaveProperty: passes when property absent', () => {
    argusExpect({ a: 1 }).not.toHaveProperty('b');
  });

  it('.not.toHaveProperty: throws when property present', () => {
    expect(() => argusExpect({ a: 1 }).not.toHaveProperty('a')).toThrow();
  });

  it('array segment path', () => {
    argusExpect({ a: { b: 10 } }).toHaveProperty(['a', 'b']);
  });
});

describe('toMatchObject', () => {
  it('passes on exact subset (AC-18)', () => {
    argusExpect({ a: 1, b: 2, c: 3 }).toMatchObject({ a: 1, b: 2 });
  });

  it('throws on value mismatch (AC-18)', () => {
    expect(() => argusExpect({ a: 1, b: 99 }).toMatchObject({ a: 1, b: 2 })).toThrow();
  });

  it('throws when subset key missing from actual', () => {
    expect(() => argusExpect({ a: 1 }).toMatchObject({ b: 1 })).toThrow();
  });

  it('recursive subset matching (AC-18)', () => {
    argusExpect({ user: { name: 'Ana', age: 30 } }).toMatchObject({ user: { name: 'Ana' } });
  });

  it('.not.toMatchObject: passes when subset does not match', () => {
    argusExpect({ a: 1 }).not.toMatchObject({ a: 99 });
  });

  it('.not.toMatchObject: throws when subset matches', () => {
    expect(() => argusExpect({ a: 1 }).not.toMatchObject({ a: 1 })).toThrow();
  });

  // R3: cyclic toMatchObject terminates (5.7b)
  it('cyclic actual terminates in toMatchObject (R3)', () => {
    const actual: Record<string, unknown> = { a: 1 };
    actual.self = actual;
    // Matching a non-cyclic subset on a cyclic object should terminate
    expect(() => argusExpect(actual).toMatchObject({ a: 1 })).not.toThrow();
    argusExpect(actual).toMatchObject({ a: 1 });
  });

  // R3: cyclic SUBSET (both sides cyclic) must terminate (verify-r1 IMPORTANT)
  it('cyclic actual AND cyclic subset terminate in toMatchObject (R3)', () => {
    const actual: Record<string, unknown> = { a: 1 };
    actual.self = actual;
    const subset: Record<string, unknown> = { a: 1 };
    subset.self = subset;
    expect(() => argusExpect(actual).toMatchObject(subset)).not.toThrow();
    argusExpect(actual).toMatchObject(subset);
  });

  // AC-36: nested Map in subset must hit the loud guard, not silently pass (verify-r1 CRITICAL)
  it('nested Map value in toMatchObject throws the Map/Set loud guard (AC-36)', () => {
    expect(() =>
      argusExpect({ m: new Map([['k', 1]]) }).toMatchObject({ m: new Map([['k', 2]]) }),
    ).toThrow('Map/Set structural equality is not supported');
  });

  it('Map actual with plain-object subset value throws the loud guard (AC-36)', () => {
    expect(() => argusExpect({ m: new Map() }).toMatchObject({ m: { k: 1 } })).toThrow(
      'Map/Set structural equality is not supported',
    );
  });
});
