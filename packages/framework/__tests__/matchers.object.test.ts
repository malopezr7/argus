/**
 * Object matchers: toHaveProperty path resolution and its omitted-vs-explicit
 * -undefined value check, and toMatchObject subset matching — including cyclic
 * inputs on both sides and the Map/Set loud guard firing on nested values.
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('toHaveProperty', () => {
  it('resolves simple key', () => {
    argusExpect({ a: 1 }).toHaveProperty('a');
  });

  it('resolves dotted path', () => {
    argusExpect({ a: { b: { c: 42 } } }).toHaveProperty('a.b.c');
  });

  it('throws on missing segment', () => {
    expect(() => argusExpect({ a: { b: {} } }).toHaveProperty('a.b.d')).toThrow();
  });

  it('value check: deep equality on resolved value', () => {
    argusExpect({ x: { y: [1, 2, 3] } }).toHaveProperty('x.y', [1, 2, 3]);
  });

  it('value check: throws for wrong value', () => {
    expect(() => argusExpect({ x: { y: [1, 2, 3] } }).toHaveProperty('x.y', [1, 2])).toThrow();
  });

  // Omitted vs explicit undefined
  it('passes presence-only for {a:undefined}', () => {
    argusExpect({ a: undefined }).toHaveProperty('a');
  });

  it('passes explicit undefined value for {a:undefined}', () => {
    argusExpect({ a: undefined }).toHaveProperty('a', undefined);
  });

  it('throws explicit undefined value for {a:5}', () => {
    expect(() => argusExpect({ a: 5 }).toHaveProperty('a', undefined)).toThrow();
  });

  it('throws when key is missing', () => {
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
  it('passes on exact subset', () => {
    argusExpect({ a: 1, b: 2, c: 3 }).toMatchObject({ a: 1, b: 2 });
  });

  it('throws on value mismatch', () => {
    expect(() => argusExpect({ a: 1, b: 99 }).toMatchObject({ a: 1, b: 2 })).toThrow();
  });

  it('throws when subset key missing from actual', () => {
    expect(() => argusExpect({ a: 1 }).toMatchObject({ b: 1 })).toThrow();
  });

  it('recursive subset matching', () => {
    argusExpect({ user: { name: 'Ana', age: 30 } }).toMatchObject({ user: { name: 'Ana' } });
  });

  it('.not.toMatchObject: passes when subset does not match', () => {
    argusExpect({ a: 1 }).not.toMatchObject({ a: 99 });
  });

  it('.not.toMatchObject: throws when subset matches', () => {
    expect(() => argusExpect({ a: 1 }).not.toMatchObject({ a: 1 })).toThrow();
  });

  // Cyclic toMatchObject terminates
  it('cyclic actual terminates in toMatchObject', () => {
    const actual: Record<string, unknown> = { a: 1 };
    actual.self = actual;
    // Matching a non-cyclic subset on a cyclic object should terminate
    expect(() => argusExpect(actual).toMatchObject({ a: 1 })).not.toThrow();
    argusExpect(actual).toMatchObject({ a: 1 });
  });

  // A cyclic SUBSET (both sides cyclic) must terminate too
  it('cyclic actual AND cyclic subset terminate in toMatchObject', () => {
    const actual: Record<string, unknown> = { a: 1 };
    actual.self = actual;
    const subset: Record<string, unknown> = { a: 1 };
    subset.self = subset;
    expect(() => argusExpect(actual).toMatchObject(subset)).not.toThrow();
    argusExpect(actual).toMatchObject(subset);
  });

  // A nested Map in the subset must hit the loud guard, not silently pass
  it('nested Map value in toMatchObject throws the Map/Set loud guard', () => {
    expect(() =>
      argusExpect({ m: new Map([['k', 1]]) }).toMatchObject({ m: new Map([['k', 2]]) }),
    ).toThrow('Map/Set structural equality is not supported');
  });

  it('Map actual with plain-object subset value throws the loud guard', () => {
    expect(() => argusExpect({ m: new Map() }).toMatchObject({ m: { k: 1 } })).toThrow(
      'Map/Set structural equality is not supported',
    );
  });
});
