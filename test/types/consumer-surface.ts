/**
 * A consumer, compiled by `tsc` against the PUBLISHED declarations.
 *
 * `test/declarations.test.ts` proves the declarations name the same members the
 * framework installs. It cannot prove those members have a usable SHAPE: a
 * matcher declared with the wrong parameters, or an `expect` static declared as
 * a property instead of a method, has the right name and still fails to compile
 * for the user.
 *
 * So this file is the other half — it does not assert anything and is never
 * executed. It is a compilation target. `pnpm typecheck` builds it against
 * `packaging/argus.d.ts` through `tsconfig.types.json`, and any use below that
 * stops typechecking is a break in the published surface, caught in the gate
 * rather than by whoever installs the next release.
 *
 * Everything here is written the way the README documents it. Nothing is
 * `any`-cast into place; a cast would hide exactly the failure this file exists
 * to catch.
 */

import { render, screen, userEvent, waitFor, waitForElementToBeRemoved, within } from 'argus';

declare global {
  interface ArgusMatchers {
    toBeWithin(low: number, high: number): void;
  }

  interface ArgusAsyncMatchers {
    toBeWithin(low: number, high: number): Promise<void>;
  }
}

// A function expression, not an arrow: a custom matcher reads `this` for
// `isNot` and `equals`, which an arrow cannot bind.
const toBeWithin = function (
  this: { isNot: boolean; equals: (a: unknown, b: unknown) => boolean },
  actual: unknown,
  ...args: unknown[]
): { pass: boolean; message: () => string } {
  const [low, high] = args as [number, number];
  const value = actual as number;
  const pass = value >= low && value <= high;
  return {
    pass,
    message: (): string =>
      this.isNot
        ? `expected ${value} not to be within ${low}..${high}`
        : `expected ${value} to be within ${low}..${high}`,
  };
};

describe('the surface a user actually touches', () => {
  // The three statics that were implemented, documented and never declared.
  expect.extend({ toBeWithin });

  test('expect.assertions guards a callback that might never run', () => {
    expect.assertions(1);
    expect(1 + 1).toBe(2);
  });

  test('expect.hasAssertions takes no argument', () => {
    expect.hasAssertions();
    expect('argus').toMatch(/^arg/);
  });

  test('a registered custom matcher is callable, including through .not', () => {
    expect(5).toBeWithin(1, 10);
    expect(50).not.toBeWithin(1, 10);
  });

  test('an undeclared matcher remains a compile error', () => {
    // @ts-expect-error undeclared matcher names must not typecheck
    expect(1).toBeee(2);
  });

  test('the built-in matchers keep their declared parameters', () => {
    expect(0.1 + 0.2).toBeCloseTo(0.3, 5);
    expect({ a: { b: 1 } }).toHaveProperty(['a', 'b'], 1);
    expect([1, 2, 3]).toHaveLength(3);
    expect(() => {
      throw new Error('boom');
    }).toThrow('boom');
  });

  test('mocks and spies carry their declared methods', () => {
    const fn = argus.fn().mockReturnValue(7);
    fn(1, 2);

    expect(fn).toHaveBeenCalledWith(1, 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls.length).toBe(1);

    const host = { greet: (): string => 'hi' };
    const spy = argus.spyOn(host, 'greet');
    host.greet();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore?.();
  });

  test('fake timers expose the documented clock controls', async () => {
    argus.useFakeTimers({ now: new Date(0), timerLimit: 1000 });
    const handle = setTimeout(() => undefined, 10);

    argus.advanceTimersByTime(5).runOnlyPendingTimers().clearAllTimers();
    await argus.advanceTimersByTimeAsync(5);
    argus.runAllTimers();
    argus.setSystemTime(100);
    const count: number = argus.getTimerCount();
    const realNow: number = argus.getRealSystemTime();
    clearTimeout(handle);
    argus.useRealTimers();

    expect(count).toBe(0);
    expect(realNow).toBeGreaterThan(0);
  });

  test('awaited matchers are thenable', async () => {
    await expect(Promise.resolve(1)).resolves.toBe(1);
    await expect(Promise.reject(new Error('no'))).rejects.toThrow('no');
    await expect(Promise.resolve(5)).resolves.toBeWithin(1, 10);
  });

  test('async component utilities and queries are thenable', async () => {
    const rendered = render({});
    const immediate = await waitFor(() => 0, { timeout: 1000, interval: 50 });
    const fromScreen = await screen.findByText('ready', { timeout: 1000, interval: 50 });
    const fromRender = await rendered.findByTestId('ready');
    const fromWithin = await within(fromRender).findAllByRole('button');
    const removed: typeof fromScreen = await waitForElementToBeRemoved(fromScreen);

    expect(immediate).toBe(0);
    expect(fromWithin).toHaveLength(1);
    expect(removed).toBe(fromScreen);
  });

  test('userEvent methods expose the documented asynchronous surface', async () => {
    const node = render({}).root;
    const user = userEvent.setup({
      delay: 0,
      advanceTimers: (delay) => Promise.resolve(delay).then(() => undefined),
    });

    const pressed: Promise<void> = user.press(node);
    await pressed;
    await user.longPress(node, { duration: 500 });
    await user.type(node, 'abc', { skipPress: true, skipBlur: true, submitEditing: true });
    await user.clear(node);
    await user.paste(node, 'text');
    await userEvent.press(node);
    await userEvent.longPress(node, { duration: 250 });
    await userEvent.type(node, 'abc');
    await userEvent.clear(node);
    await userEvent.paste(node, 'text');

    expect(user.config.delay).toBe(0);
  });
});
