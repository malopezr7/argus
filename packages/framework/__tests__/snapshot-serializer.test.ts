import { describe, expect, it } from 'vitest';
import { serializeSnapshot } from '../src/snapshot/serialize.js';

describe('serializeSnapshot', () => {
  it('serializes the supported primitive subset with exact escaping', () => {
    expect(serializeSnapshot(null)).toBe('null');
    expect(serializeSnapshot(undefined)).toBe('undefined');
    expect(serializeSnapshot(true)).toBe('true');
    expect(serializeSnapshot(false)).toBe('false');
    expect(serializeSnapshot(Number.NaN)).toBe('NaN');
    expect(serializeSnapshot(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(serializeSnapshot(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
    expect(serializeSnapshot(-0)).toBe('-0');
    expect(serializeSnapshot(1.5)).toBe('1.5');
    expect(serializeSnapshot('quote" slash\\\n\u001b\u2028\ud800')).toBe(
      '"quote\\" slash\\\\\\n\\u001b\\u2028\\ud800"',
    );
  });

  it('sorts object keys by UTF-16 code unit and renders nested values', () => {
    const value = {
      z: 2,
      a: [true, { beta: 'b', alpha: 'a' }],
      '10': 'ten',
      '2': 'two',
    };

    expect(serializeSnapshot(value)).toBe(`{
  "10": "ten",
  "2": "two",
  "a": [
    true,
    {
      "alpha": "a",
      "beta": "b",
    },
  ],
  "z": 2,
}`);
  });

  it('canonicalizes Map and Set independently of insertion order', () => {
    const firstMap = new Map<unknown, unknown>([
      ['z', 2],
      ['a', 1],
    ]);
    const secondMap = new Map<unknown, unknown>([
      ['a', 1],
      ['z', 2],
    ]);
    const firstSet = new Set<unknown>(['z', 'a']);
    const secondSet = new Set<unknown>(['a', 'z']);

    expect(serializeSnapshot(firstMap)).toBe(serializeSnapshot(secondMap));
    expect(serializeSnapshot(firstMap)).toBe(`Map {
  "a" => 1,
  "z" => 2,
}`);
    expect(serializeSnapshot(firstSet)).toBe(serializeSnapshot(secondSet));
    expect(serializeSnapshot(firstSet)).toBe(`Set {
  "a",
  "z",
}`);
  });

  it('does not depend on Array.prototype.sort', () => {
    const original = Array.prototype.sort;
    Array.prototype.sort = function poisonedSort(): never {
      throw new Error('sort poisoned');
    };
    try {
      expect(serializeSnapshot({ z: 2, a: 1, set: new Set(['z', 'a']) })).toBe(`{
  "a": 1,
  "set": Set {
    "a",
    "z",
  },
  "z": 2,
}`);
    } finally {
      Array.prototype.sort = original;
    }
  });

  it('captures number formatting before user prototype pollution', () => {
    const original = Number.prototype.toString;
    Number.prototype.toString = function poisonedNumberToString(): never {
      throw new Error('number formatting poisoned');
    };
    try {
      expect(serializeSnapshot('line\u2028separator')).toBe('"line\\u2028separator"');
    } finally {
      Number.prototype.toString = original;
    }
  });

  it('captures string inspection before user prototype pollution', () => {
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalIndexOf = String.prototype.indexOf;
    const originalSlice = String.prototype.slice;
    const originalRegExpTest = RegExp.prototype.test;
    let failure: unknown;
    let outputs: string[] = [];

    String.prototype.charCodeAt = function poisonedCharCodeAt(): never {
      throw new Error('character inspection poisoned');
    };
    String.prototype.indexOf = function poisonedIndexOf(): never {
      throw new Error('string search poisoned');
    };
    String.prototype.slice = function poisonedSlice(): never {
      throw new Error('string slicing poisoned');
    };
    RegExp.prototype.test = function poisonedRegExpTest(): never {
      throw new Error('regexp test poisoned');
    };
    try {
      outputs = [
        serializeSnapshot('line\u2028separator'),
        serializeSnapshot(1e21),
        serializeSnapshot({
          type: 'View',
          props: { data: { value: 1 } },
          parent: null,
          children: [],
        }),
      ];
    } catch (error) {
      failure = error;
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
      String.prototype.indexOf = originalIndexOf;
      String.prototype.slice = originalSlice;
      RegExp.prototype.test = originalRegExpTest;
    }

    expect(failure).toBeUndefined();
    expect(outputs[0]).toBe('"line\\u2028separator"');
    expect(outputs[1]).toBe('1e21');
    expect(outputs[2]).toContain('<View');
  });

  it('captures value classifiers before user global mutation', () => {
    const map = new Map<unknown, unknown>([['key', 'value']]);
    const set = new Set<unknown>(['value']);
    const originalArrayIsArray = Array.isArray;
    const originalNumberIsNaN = Number.isNaN;
    const originalObjectIs = Object.is;
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalMap = globals.Map;
    const originalSet = globals.Set;
    let failure: unknown;
    let outputs: string[] = [];

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
      outputs = [
        serializeSnapshot([1]),
        serializeSnapshot(Number.NaN),
        serializeSnapshot(-0),
        serializeSnapshot(map),
        serializeSnapshot(set),
      ];
    } catch (error) {
      failure = error;
    } finally {
      Array.isArray = originalArrayIsArray;
      Number.isNaN = originalNumberIsNaN;
      Object.is = originalObjectIs;
      globals.Map = originalMap;
      globals.Set = originalSet;
    }

    expect(failure).toBeUndefined();
    expect(outputs).toEqual([
      '[\n  1,\n]',
      'NaN',
      '-0',
      'Map {\n  "key" => "value",\n}',
      'Set {\n  "value",\n}',
    ]);
  });

  it('renders a synthetic HostNode root as its children without a fake element', () => {
    const root = {
      type: '',
      props: {},
      parent: null,
      children: [
        {
          type: 'View',
          props: { testID: 'cta', accessibilityRole: 'button' },
          parent: null,
          children: [
            {
              type: 'Text',
              props: {},
              parent: null,
              children: ['Save'],
            },
          ],
        },
        {
          type: 'Text',
          props: {},
          parent: null,
          children: ['After'],
        },
      ],
    };

    expect(serializeSnapshot(root)).toBe(`<View
  accessibilityRole="button"
  testID="cta"
>
  <Text>
    "Save"
  </Text>
</View>
<Text>
  "After"
</Text>`);
  });

  it.each([
    ['bigint', 1n],
    ['symbol', Symbol('x')],
    ['function', function unsupported() {}],
    ['date', new Date(0)],
    ['regexp', /x/],
    ['weak map', new WeakMap()],
  ])('rejects unsupported %s values instead of emitting a lossy label', (_label, value) => {
    expect(() => serializeSnapshot(value)).toThrow(/Unsupported snapshot value/);
  });

  it('rejects cycles, sparse arrays, accessors, symbol keys, and custom prototypes', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    const sparse = new Array(2);
    sparse[1] = 'present';

    const accessor = {};
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });

    const symbolKeyed = { visible: true } as Record<PropertyKey, unknown>;
    symbolKeyed[Symbol('hidden')] = 1;

    const custom = Object.create({ inherited: true }) as Record<string, unknown>;
    custom.own = true;

    for (const value of [cyclic, sparse, accessor, symbolKeyed, custom]) {
      expect(() => serializeSnapshot(value)).toThrow(/Unsupported snapshot value/);
    }
  });
});
