/**
 * Valid JavaScript syntax whose leading comment contains a semicolon. The
 * legacy lowering gate used to treat that semicolon as proof no body followed,
 * leaving the declaration for Hermes to reject before any test could run.
 *
 * Expected: all tests pass, exit code 0, on either engine.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };

class /* ; */ CommentedClass {
  value(): string {
    return 'lowered';
  }
}

describe('commented declaration syntax', () => {
  test('a semicolon inside the leading comment does not block execution', () => {
    expect(new CommentedClass().value()).toBe('lowered');
  });
});
