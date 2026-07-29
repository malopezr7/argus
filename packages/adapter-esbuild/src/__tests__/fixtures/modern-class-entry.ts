/**
 * Every class form the two engines disagree about, in the user's own source:
 * a base class, `extends` + `super`, a private field and a static block.
 *
 * Legacy rejects all four outright; V1 parses all four. So one fixture proves
 * lowering happened on legacy and did NOT happen on V1.
 */
export class Base {
  greet(): string {
    return 'base';
  }
}

export class Derived extends Base {
  #secret = 41;

  static tag = 'unset';

  static {
    Derived.tag = 'derived';
  }

  override greet(): string {
    return `${super.greet()}+${this.#secret + 1}`;
  }
}

console.log(new Derived().greet(), Derived.tag);
