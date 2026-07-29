/**
 * A class in the USER's own TypeScript, outside node_modules.
 *
 * Uses a TS parameter property, so the file cannot reach Babel unless the
 * TypeScript is stripped first — which is exactly the path the legacy engine
 * needs and the reason this fixture is TypeScript rather than JavaScript.
 */
export class Punto {
  constructor(public x: number) {}

  dob(): number {
    return this.x * 2;
  }
}

console.log(new Punto(2).dob());
