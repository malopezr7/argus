/**
 * Truthiness matchers: toBeTruthy, toBeFalsy, toBeNull, toBeUndefined,
 * toBeDefined, and toBeNaN — with their .not forms.
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('toBeTruthy', () => {
  it('passes for truthy value', () => {
    argusExpect(1).toBeTruthy();
    argusExpect('hello').toBeTruthy();
    argusExpect({}).toBeTruthy();
  });

  it('throws for falsy value', () => {
    expect(() => argusExpect(0).toBeTruthy()).toThrow();
    expect(() => argusExpect('').toBeTruthy()).toThrow();
    expect(() => argusExpect(null).toBeTruthy()).toThrow();
  });

  it('.not.toBeTruthy: passes for falsy', () => {
    argusExpect(0).not.toBeTruthy();
  });

  it('.not.toBeTruthy: throws for truthy', () => {
    expect(() => argusExpect(1).not.toBeTruthy()).toThrow();
  });
});

describe('toBeFalsy', () => {
  it('passes for falsy value', () => {
    argusExpect(0).toBeFalsy();
    argusExpect('').toBeFalsy();
    argusExpect(null).toBeFalsy();
    argusExpect(undefined).toBeFalsy();
    argusExpect(false).toBeFalsy();
  });

  it('throws for truthy value', () => {
    expect(() => argusExpect(1).toBeFalsy()).toThrow();
  });

  it('.not.toBeFalsy: passes for truthy', () => {
    argusExpect(1).not.toBeFalsy();
  });
});

describe('toBeNull', () => {
  it('passes for null', () => {
    argusExpect(null).toBeNull();
  });

  it('throws for undefined (null !== undefined)', () => {
    expect(() => argusExpect(undefined).toBeNull()).toThrow();
  });

  it('.not.toBeNull: passes for non-null', () => {
    argusExpect(0).not.toBeNull();
  });

  it('.not.toBeNull: throws for null', () => {
    expect(() => argusExpect(null).not.toBeNull()).toThrow();
  });
});

describe('toBeUndefined', () => {
  it('passes for undefined', () => {
    argusExpect(undefined).toBeUndefined();
  });

  it('throws for null', () => {
    expect(() => argusExpect(null).toBeUndefined()).toThrow();
  });

  it('.not.toBeUndefined: passes for defined', () => {
    argusExpect(0).not.toBeUndefined();
  });
});

describe('toBeDefined', () => {
  it('passes for non-undefined value', () => {
    argusExpect(0).toBeDefined();
    argusExpect(null).toBeDefined();
    argusExpect('').toBeDefined();
  });

  it('throws for undefined', () => {
    expect(() => argusExpect(undefined).toBeDefined()).toThrow();
  });

  it('.not.toBeDefined: throws for defined', () => {
    expect(() => argusExpect(1).not.toBeDefined()).toThrow();
  });
});

describe('toBeNaN', () => {
  it('passes for NaN', () => {
    argusExpect(NaN).toBeNaN();
  });

  it('throws for 0', () => {
    expect(() => argusExpect(0).toBeNaN()).toThrow();
  });

  it('throws for string NaN (not a number)', () => {
    expect(() => argusExpect('NaN').toBeNaN()).toThrow();
  });

  it('.not.toBeNaN: passes for non-NaN', () => {
    argusExpect(0).not.toBeNaN();
  });
});
