/**
 * Numeric comparison matchers: toBeGreaterThan(OrEqual), toBeLessThan(OrEqual),
 * and toBeCloseTo — including how numDigits sets the tolerance.
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('toBeGreaterThan', () => {
  it('passes when actual > n', () => {
    argusExpect(5).toBeGreaterThan(4);
  });

  it('throws when actual === n (strict inequality)', () => {
    expect(() => argusExpect(5).toBeGreaterThan(5)).toThrow();
  });

  it('throws when actual < n', () => {
    expect(() => argusExpect(3).toBeGreaterThan(5)).toThrow();
  });

  it('.not.toBeGreaterThan: passes when actual <= n', () => {
    argusExpect(4).not.toBeGreaterThan(5);
    argusExpect(5).not.toBeGreaterThan(5);
  });
});

describe('toBeGreaterThanOrEqual', () => {
  it('passes when actual >= n', () => {
    argusExpect(5).toBeGreaterThanOrEqual(5);
    argusExpect(6).toBeGreaterThanOrEqual(5);
  });

  it('throws when actual < n', () => {
    expect(() => argusExpect(4).toBeGreaterThanOrEqual(5)).toThrow();
  });
});

describe('toBeLessThan', () => {
  it('passes when actual < n', () => {
    argusExpect(4).toBeLessThan(5);
  });

  it('throws when actual === n (strict)', () => {
    expect(() => argusExpect(5).toBeLessThan(5)).toThrow();
  });

  it('.not.toBeLessThan: passes when actual >= n', () => {
    argusExpect(5).not.toBeLessThan(5);
    argusExpect(6).not.toBeLessThan(5);
  });
});

describe('toBeLessThanOrEqual', () => {
  it('passes when actual <= n', () => {
    argusExpect(5).toBeLessThanOrEqual(5);
    argusExpect(4).toBeLessThanOrEqual(5);
  });

  it('throws when actual > n', () => {
    expect(() => argusExpect(6).toBeLessThanOrEqual(5)).toThrow();
  });
});

describe('toBeCloseTo', () => {
  it('0.1+0.2 passes with default numDigits=2', () => {
    argusExpect(0.1 + 0.2).toBeCloseTo(0.3);
  });

  it('0.1+0.2 fails with numDigits=20 (small enough tolerance that diff exceeds it)', () => {
    // tolerance = 10^-20 / 2 = 5e-21; diff ≈ 4.44e-17 > 5e-21 → fails
    expect(() => argusExpect(0.1 + 0.2).toBeCloseTo(0.3, 20)).toThrow();
  });

  it('exactly equal values pass at any numDigits', () => {
    argusExpect(1.0).toBeCloseTo(1.0, 10);
  });

  it('.not.toBeCloseTo: passes when not close', () => {
    argusExpect(1.0).not.toBeCloseTo(2.0);
  });

  it('.not.toBeCloseTo: throws when close', () => {
    expect(() => argusExpect(0.1 + 0.2).not.toBeCloseTo(0.3)).toThrow();
  });
});
