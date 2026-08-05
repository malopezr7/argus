import { render } from 'argus';
import React from 'react';

describe('snapshot parity', () => {
  test('serializes canonical values', () => {
    expect({
      text: 'Hermes',
      numbers: [
        -0,
        1.5,
        1e-7,
        0.000001,
        1e21,
        Number.MIN_VALUE,
        Number.MAX_VALUE,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ],
      keys: { z: 4, a: 3, '10': 2, '2': 1 },
      map: new Map([
        ['z', 2],
        ['a', 1],
      ]),
      set: new Set(['z', 'a']),
    }).toMatchSnapshot();
  });

  test('serializes a component HostNode without a synthetic wrapper', () => {
    const tree = render(
      React.createElement(
        'View',
        { accessibilityRole: 'summary', testID: 'snapshot-root' },
        React.createElement('Text', null, 'Same bytes on both engines'),
      ),
    );

    expect(tree.root).toMatchSnapshot('component');
  });

  test('stays deterministic when Array.prototype.sort is poisoned', () => {
    const original = Array.prototype.sort;
    Array.prototype.sort = function poisonedSort(): never {
      throw new Error('Array.prototype.sort must not be used by snapshots');
    };
    try {
      expect({ z: 2, a: 1, set: new Set(['z', 'a']) }).toMatchSnapshot('sort pollution');
    } finally {
      Array.prototype.sort = original;
    }
  });

  test('captures snapshot primordials before user code evaluates', () => {
    const payload = {
      line: 'line\u2028separator',
      exponent: 1e21,
      array: [1],
      map: new Map([['key', 'value']]),
      set: new Set(['value']),
    };
    const assertion = expect(payload);
    const originalNumberToString = Number.prototype.toString;
    const originalStringCharCodeAt = String.prototype.charCodeAt;
    const originalStringIndexOf = String.prototype.indexOf;
    const originalStringSlice = String.prototype.slice;
    const originalRegExpTest = RegExp.prototype.test;
    const originalArrayIsArray = Array.isArray;
    const originalNumberIsNaN = Number.isNaN;
    const originalObjectIs = Object.is;
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalMap = globals.Map;
    const originalSet = globals.Set;

    Number.prototype.toString = function poisonedNumberToString(): never {
      throw new Error('number formatting poisoned');
    };
    String.prototype.charCodeAt = function poisonedStringCharCodeAt(): never {
      throw new Error('character inspection poisoned');
    };
    String.prototype.indexOf = function poisonedStringIndexOf(): never {
      throw new Error('string search poisoned');
    };
    String.prototype.slice = function poisonedStringSlice(): never {
      throw new Error('string slicing poisoned');
    };
    RegExp.prototype.test = function poisonedRegExpTest(): never {
      throw new Error('regexp test poisoned');
    };
    Array.isArray = function poisonedArrayIsArray(): never {
      throw new Error('array classification poisoned');
    };
    Number.isNaN = function poisonedNumberIsNaN(): never {
      throw new Error('number classification poisoned');
    };
    Object.is = function poisonedObjectIs(): never {
      throw new Error('object identity poisoned');
    };
    globals.Map = function PoisonedMap() {};
    globals.Set = function PoisonedSet() {};
    try {
      assertion.toMatchSnapshot('primordial pollution');
    } finally {
      Number.prototype.toString = originalNumberToString;
      String.prototype.charCodeAt = originalStringCharCodeAt;
      String.prototype.indexOf = originalStringIndexOf;
      String.prototype.slice = originalStringSlice;
      RegExp.prototype.test = originalRegExpTest;
      Array.isArray = originalArrayIsArray;
      Number.isNaN = originalNumberIsNaN;
      Object.is = originalObjectIs;
      globals.Map = originalMap;
      globals.Set = originalSet;
    }
  });
});
