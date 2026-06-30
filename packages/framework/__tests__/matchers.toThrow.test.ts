/**
 * toThrow matcher tests — task 5.8 + 5.8b
 * AC-19..22, AC-39, REQ-06, ADR-6, R8
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('toThrow', () => {
  // AC-19: no arg — any throw passes
  it('passes when fn throws (no arg, AC-19)', () => {
    argusExpect(() => {
      throw new Error('boom');
    }).toThrow();
  });

  // AC-19: fails when fn does not throw
  it('throws when fn does not throw (AC-19)', () => {
    expect(() => argusExpect(() => 42).toThrow()).toThrow();
  });

  // AC-20: string substring match
  it('passes for string substring match (AC-20)', () => {
    argusExpect(() => {
      throw new Error('connection refused');
    }).toThrow('refused');
  });

  it('throws for string substring mismatch (AC-20)', () => {
    expect(() =>
      argusExpect(() => {
        throw new Error('connection refused');
      }).toThrow('timeout'),
    ).toThrow();
  });

  // AC-21: RegExp match
  it('passes for RegExp match (AC-21)', () => {
    argusExpect(() => {
      throw new Error('invalid token: abc123');
    }).toThrow(/invalid token: \w+/);
  });

  it('throws for RegExp mismatch', () => {
    expect(() =>
      argusExpect(() => {
        throw new Error('ok');
      }).toThrow(/fail/),
    ).toThrow();
  });

  // AC-22: Error subclass instanceof
  it('passes for TypeError subclass instanceof (AC-22)', () => {
    argusExpect(() => {
      throw new TypeError('bad type');
    }).toThrow(TypeError);
  });

  it('throws for wrong class instanceof (AC-22)', () => {
    expect(() =>
      argusExpect(() => {
        throw new TypeError('bad type');
      }).toThrow(RangeError),
    ).toThrow();
  });

  // AC-39 / R8: Error instance — match on message substring
  it('passes when thrown message contains Error instance message (AC-39)', () => {
    argusExpect(() => {
      throw new Error('disk full: /tmp');
    }).toThrow(new Error('disk full'));
  });

  it('throws when thrown message does not contain Error instance message', () => {
    expect(() =>
      argusExpect(() => {
        throw new Error('different error');
      }).toThrow(new Error('disk full')),
    ).toThrow();
  });

  // Non-function usage error (ADR-6)
  it('throws usage error for non-function actual', () => {
    expect(() => argusExpect(42).toThrow()).toThrow('requires a function');
  });

  it('throws usage error for non-function actual even with .not', () => {
    expect(() => argusExpect('not a fn').toThrow()).toThrow('requires a function');
  });

  // .not.toThrow
  it('.not.toThrow: passes when fn does not throw', () => {
    argusExpect(() => 42).not.toThrow();
  });

  it('.not.toThrow: throws when fn throws', () => {
    expect(() =>
      argusExpect(() => {
        throw new Error('oops');
      }).not.toThrow(),
    ).toThrow();
  });

  // Custom Error subclass
  it('passes for custom Error subclass (AC-22)', () => {
    class MyError extends Error {}
    argusExpect(() => {
      throw new MyError('custom');
    }).toThrow(MyError);
  });

  it('throws when thrown is custom subclass but expected is parent', () => {
    class MyError extends Error {}
    // MyError instance IS an instance of Error
    argusExpect(() => {
      throw new MyError('x');
    }).toThrow(Error);
  });
});
