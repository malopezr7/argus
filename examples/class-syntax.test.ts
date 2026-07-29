/**
 * A class in the USER's own test file — the shape that used to kill the whole
 * file on the legacy engine.
 *
 * Legacy Hermes cannot parse `class` in any form, so before the bundler's
 * target was derived from the resolved engine this file failed with
 * `INFRASTRUCTURE FAILURE [engine] ... Invalid expression encountered` before a
 * single test ran. It became urgent when engine resolution started correctly
 * sending RN 0.82/0.83 projects to legacy, where they had previously been given
 * V1 by mistake.
 *
 * Deliberately engine-AGNOSTIC: it asserts behaviour, never representation. On
 * legacy every construct below is lowered (esbuild drops the ES2022 class
 * features to the es2020 target, Babel then removes `class` itself); on V1 all
 * of it runs natively. Both must produce the same answers, which is the whole
 * claim.
 *
 * Expected: all tests pass, exit code 0, on either engine.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };

class Punto {
  constructor(public x: number) {}

  dob(): number {
    return this.x * 2;
  }

  get etiqueta(): string {
    return `punto:${this.x}`;
  }

  static origen(): Punto {
    return new Punto(0);
  }
}

class Hijo extends Punto {
  /** Private field — ES2022, rejected by legacy, lowered on the way in. */
  #bonus = 1;

  /** Static block — ES2022, likewise. */
  static tag = 'unset';
  static {
    Hijo.tag = 'hijo';
  }

  override dob(): number {
    return super.dob() + this.#bonus;
  }
}

describe("class syntax in the user's own test file", () => {
  test('a plain class constructs and its method runs', () => {
    expect(new Punto(2).dob()).toBe(4);
  });

  test('a TypeScript parameter property becomes a real field', () => {
    expect(new Punto(7).x).toBe(7);
  });

  test('a getter works', () => {
    expect(new Punto(3).etiqueta).toBe('punto:3');
  });

  test('a static method works', () => {
    expect(Punto.origen().x).toBe(0);
  });

  test('extends + super reaches the base implementation', () => {
    expect(new Hijo(2).dob()).toBe(5);
  });

  test('a private field stays readable from inside the class', () => {
    expect(new Hijo(10).dob()).toBe(21);
  });

  test('a static block ran at class definition time', () => {
    expect(Hijo.tag).toBe('hijo');
  });

  test('instanceof still relates the two classes', () => {
    expect(new Hijo(1) instanceof Punto).toBe(true);
  });

  test('a class expression is a class too', () => {
    const Anon = class {
      valor(): number {
        return 9;
      }
    };
    expect(new Anon().valor()).toBe(9);
  });
});
