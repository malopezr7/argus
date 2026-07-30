/**
 * A class field over an inherited accessor, under `useDefineForClassFields:
 * false` — TypeScript's ASSIGN semantics, where `v = 1` runs the base setter.
 *
 * With define semantics (the ES default) the field is installed with
 * Object.defineProperty and the setter never runs. Same source, two different
 * behaviours, chosen entirely by the project's tsconfig.
 */
class Base {
  seen: number[] = [];

  set v(value: number) {
    this.seen.push(value);
  }

  get v(): number {
    return -1;
  }
}

export class Child extends Base {
  v = 1;
}

console.log(new Child().seen.length);
