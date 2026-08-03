/**
 * jest-api integration fixture — exercises the full Jest-API surface on real Hermes.
 * Run with: pnpm argus examples/jest-api.test.ts
 * Expected: exit 0 (all tests pass).
 */
declare const describe: (
  name: string,
  fn: () => void,
) => void & {
  skip: (name: string, fn: () => void) => void;
  only: (name: string, fn: () => void) => void;
};
declare const test: (
  name: string,
  fn: () => void | Promise<unknown>,
) => void & {
  skip: (name: string, fn?: () => void | Promise<unknown>) => void;
  only: (name: string, fn: () => void | Promise<unknown>) => void;
  todo: (name: string, fn?: () => void | Promise<unknown>) => void;
};
declare const it: typeof test;
declare const beforeAll: (fn: () => void | Promise<unknown>) => void;
declare const afterAll: (fn: () => void | Promise<unknown>) => void;
declare const beforeEach: (fn: () => void | Promise<unknown>) => void;
declare const afterEach: (fn: () => void | Promise<unknown>) => void;
declare const expect: <T>(actual: T) => {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
  toMatch(pattern: string | RegExp): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeNull(): void;
  not: {
    toBe(expected: T): void;
    toBeNull(): void;
  };
  resolves: {
    toBe(expected: T): Promise<void>;
    toEqual(expected: unknown): Promise<void>;
  };
  rejects: {
    toThrow(expected?: unknown): Promise<void>;
  };
};

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

describe('lifecycle hooks', () => {
  const log: string[] = [];

  beforeAll(function setupAll() {
    log.push('beforeAll');
  });

  afterAll(function teardownAll() {
    // afterAll runs after all tests in the block
  });

  beforeEach(function eachSetup() {
    log.push('beforeEach');
  });

  afterEach(function eachTeardown() {
    log.push('afterEach');
  });

  test('beforeAll ran before first test', function () {
    // log starts with 'beforeAll', then 'beforeEach' for this test
    var bai = log.indexOf('beforeAll');
    var bei = log.indexOf('beforeEach');
    if (bai === -1) {
      throw new Error('beforeAll never ran');
    }
    if (bei === -1) {
      throw new Error('beforeEach never ran');
    }
    if (bai > bei) {
      throw new Error('beforeAll must precede beforeEach');
    }
  });

  test('beforeEach runs for each test', function () {
    var count = 0;
    for (var i = 0; i < log.length; i++) {
      if (log[i] === 'beforeEach') {
        count++;
      }
    }
    // by the time this test body runs, beforeEach has fired at least twice
    if (count < 2) {
      throw new Error('expected beforeEach to have run at least twice, got ' + count);
    }
  });
});

// ---------------------------------------------------------------------------
// test.skip
// ---------------------------------------------------------------------------

describe('modifiers', () => {
  test('passing test', function () {
    expect(1 + 1).toBe(2);
  });

  test.skip('skipped test — never executed', function () {
    throw new Error('should never run');
  });

  test.todo('todo placeholder — no body needed');
});

// ---------------------------------------------------------------------------
// it alias
// ---------------------------------------------------------------------------

describe('it alias', () => {
  it('it() behaves like test()', function () {
    expect('it').toEqual('it');
  });
});

// ---------------------------------------------------------------------------
// async matchers — resolves / rejects
// ---------------------------------------------------------------------------

describe('async matchers', () => {
  test('resolves.toBe — resolved value matches', async function () {
    await expect(Promise.resolve(42)).resolves.toBe(42);
  });

  test('resolves.toEqual — resolved object matches', async function () {
    await expect(Promise.resolve({ ok: true })).resolves.toEqual({ ok: true });
  });

  test('rejects.toThrow — rejected error matches message', async function () {
    await expect(Promise.reject(new Error('boom'))).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// Nested describe with .only re-narrowing
// Outer describe.only selects the block; inner test.only re-narrows within it.
// All non-.only siblings inside should be skipped.
// ---------------------------------------------------------------------------

describe('nested hooks', () => {
  var outer: string[] = [];

  beforeAll(function () {
    outer.push('outer-before-all');
  });

  afterAll(function () {
    outer.push('outer-after-all');
  });

  describe('inner', function () {
    var inner: string[] = [];

    beforeAll(function () {
      inner.push('inner-before-all');
    });

    afterAll(function () {
      inner.push('inner-after-all');
    });

    test('inner test sees outer beforeAll result', function () {
      if (outer.indexOf('outer-before-all') === -1) {
        throw new Error('outer beforeAll did not run before inner test');
      }
    });

    test('inner beforeAll ran', function () {
      if (inner.indexOf('inner-before-all') === -1) {
        throw new Error('inner beforeAll never ran');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// A todo-only suite MUST NOT trigger lifecycle hooks.
// This exercises the REAL index.ts runner (not just the in-process harness).
// ---------------------------------------------------------------------------

var todoHookLog: string[] = [];

describe('todo-only suite (hooks must not run)', function () {
  beforeAll(function () {
    todoHookLog.push('BA');
  });
  afterAll(function () {
    todoHookLog.push('AA');
  });
  test.todo('pending a');
  test.todo('pending b');
});

describe('todo-only hook verification', function () {
  test('a todo-only suite did not run beforeAll/afterAll', function () {
    if (todoHookLog.length !== 0) {
      throw new Error('todo-only suite ran hooks: ' + todoHookLog.join(','));
    }
  });
});
