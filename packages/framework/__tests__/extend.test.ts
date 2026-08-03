/**
 * expect.extend: custom matchers pass/fail correctly, compose with .not, are
 * merged additively across calls, and receive this.isNot / this.equals.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { expect as argusExpect, resetAssertions } from '../src/matchers.js';

// Reset assertion count before each test to avoid bleed
beforeEach(() => {
  resetAssertions();
});

describe('expect.extend', () => {
  it('custom matcher passes and fails correctly', () => {
    (argusExpect as unknown as { extend(t: Record<string, unknown>): void }).extend({
      toBeEven(this: { isNot: boolean }, actual: unknown) {
        const pass = typeof actual === 'number' && (actual as number) % 2 === 0;
        return { pass, message: () => (this.isNot ? 'expected odd' : 'expected even') };
      },
    });

    // passes
    (argusExpect(4) as unknown as { toBeEven(): void }).toBeEven();

    // fails
    expect(() => {
      (argusExpect(3) as unknown as { toBeEven(): void }).toBeEven();
    }).toThrow();
  });

  it('custom matcher composes with .not', () => {
    // passes (3 is odd → not.toBeEven passes)
    (argusExpect(3).not as unknown as { toBeEven(): void }).toBeEven();

    // fails (4 is even → not.toBeEven fails)
    expect(() => {
      (argusExpect(4).not as unknown as { toBeEven(): void }).toBeEven();
    }).toThrow();
  });

  it('expect.extend is additive: second call does not remove first', () => {
    (argusExpect as unknown as { extend(t: Record<string, unknown>): void }).extend({
      matcherA(_actual: unknown) {
        return { pass: true, message: () => 'A' };
      },
    });
    (argusExpect as unknown as { extend(t: Record<string, unknown>): void }).extend({
      matcherB(_actual: unknown) {
        return { pass: true, message: () => 'B' };
      },
    });

    // both should be callable
    (argusExpect(1) as unknown as { matcherA(): void }).matcherA();
    (argusExpect(1) as unknown as { matcherB(): void }).matcherB();
  });

  it('custom matcher reads this.isNot and this.equals', () => {
    (argusExpect as unknown as { extend(t: Record<string, unknown>): void }).extend({
      toBeWithin(
        this: { isNot: boolean; equals(a: unknown, b: unknown): boolean },
        actual: unknown,
        min: unknown,
        max: unknown,
      ) {
        const pass =
          typeof actual === 'number' &&
          (actual as number) >= (min as number) &&
          (actual as number) <= (max as number);
        return {
          pass,
          message: () => (this.isNot ? 'expected outside range' : 'expected within range'),
        };
      },
    });

    // passes
    (argusExpect(5) as unknown as { toBeWithin(a: number, b: number): void }).toBeWithin(1, 10);

    // not composition: isNot = true, should throw for in-range value
    expect(() => {
      (argusExpect(5).not as unknown as { toBeWithin(a: number, b: number): void }).toBeWithin(
        1,
        10,
      );
    }).toThrow('expected outside range');
  });
});
