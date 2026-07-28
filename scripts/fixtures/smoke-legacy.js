// Smoke and bytecode-parity fixture for the legacy Hermes engine.
//
// Uses only syntax the legacy parser accepts: no class bodies, no private
// fields, no static blocks. Closure state stands in for the private field so
// the fixture still proves execution rather than parsing alone.
//
// Prints the same line as smoke-v1.js so both engines share one expectation.

const makeCounter = () => {
  let value = 0;

  return {
    bump() {
      value += 1;
      return value;
    },
    peek() {
      return value;
    },
  };
};

const counter = makeCounter();
counter.bump();
counter.bump();
counter.bump();

print(
  JSON.stringify({
    ok: counter.peek() === 3,
    n: counter.bump(),
    label: 'counter',
  }),
);
