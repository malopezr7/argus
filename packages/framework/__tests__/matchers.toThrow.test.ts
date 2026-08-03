/**
 * toThrow matcher tests — every accepted argument form (none, string, RegExp,
 * Error class, Error instance), the non-function usage error, and .not.
 */
import { describe, expect, it } from 'vitest';
import { expect as argusExpect } from '../src/matchers.js';

describe('toThrow', () => {
  // No arg — any throw passes
  it('passes when fn throws (no arg)', () => {
    argusExpect(() => {
      throw new Error('boom');
    }).toThrow();
  });

  it('throws when fn does not throw', () => {
    expect(() => argusExpect(() => 42).toThrow()).toThrow();
  });

  // String substring match
  it('passes for string substring match', () => {
    argusExpect(() => {
      throw new Error('connection refused');
    }).toThrow('refused');
  });

  it('throws for string substring mismatch', () => {
    expect(() =>
      argusExpect(() => {
        throw new Error('connection refused');
      }).toThrow('timeout'),
    ).toThrow();
  });

  // RegExp match
  it('passes for RegExp match', () => {
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

  // Error subclass instanceof
  it('passes for TypeError subclass instanceof', () => {
    argusExpect(() => {
      throw new TypeError('bad type');
    }).toThrow(TypeError);
  });

  it('throws for wrong class instanceof', () => {
    expect(() =>
      argusExpect(() => {
        throw new TypeError('bad type');
      }).toThrow(RangeError),
    ).toThrow();
  });

  // Error instance — match on message substring
  it('passes when thrown message contains Error instance message', () => {
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

  // Non-function usage error
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
  it('passes for custom Error subclass', () => {
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
