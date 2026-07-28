// Smoke and bytecode-parity fixture for Hermes V1.
//
// Deliberately built from syntax the legacy engine cannot parse — class bodies,
// private fields, static blocks and the ergonomic brand check. A fixture the
// legacy parser also accepts would make the parity comparison prove much less,
// because the interesting half of the V0-to-V1 delta is in the parser.
//
// Prints the same line as smoke-legacy.js so both engines share one expectation.

class Counter {
  #value = 0;
  static label;

  static {
    Counter.label = 'counter';
  }

  bump() {
    this.#value += 1;
    return this.#value;
  }

  static holds(candidate) {
    return #value in candidate;
  }
}

const counter = new Counter();
counter.bump();
counter.bump();
counter.bump();

print(
  JSON.stringify({
    ok: Counter.holds(counter),
    n: counter.bump(),
    label: Counter.label,
  }),
);
