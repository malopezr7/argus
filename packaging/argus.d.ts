/**
 * Type declarations for the Argus test environment.
 *
 * Two things need declaring, and neither is an ordinary import:
 *
 *   1. `describe` / `test` / `expect` and friends are GLOBALS. The framework
 *      installs them onto the Hermes global object before any test module runs,
 *      so nothing imports them and TypeScript has nothing to infer them from.
 *
 *   2. `argus` is a VIRTUAL module. There is no `node_modules/argus`; the
 *      specifier is rewritten by an esbuild alias at bundle time, pointing at
 *      the component-testing layer that ships inside this package.
 *
 * This file is a global script — it has no top-level `import` or `export`, which
 * is what allows `declare module` here to be an AMBIENT declaration rather than
 * a module augmentation. Adding a top-level import to this file would silently
 * stop the `argus` module from being declared at all.
 *
 * Activate it with either:
 *
 *   // tsconfig.json
 *   { "compilerOptions": { "types": ["@arguslab/argus"] } }
 *
 * or, with no tsconfig change at all, a single line in one of your own files:
 *
 *   /// <reference types="@arguslab/argus" />
 *
 * React types are referenced structurally rather than imported, so a project
 * with no React installed still typechecks against this file.
 */

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

interface ArgusMatchers {
  readonly not: ArgusMatchers;
  readonly resolves: ArgusAsyncMatchers;
  readonly rejects: ArgusAsyncMatchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeNaN(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toBeCloseTo(expected: number, numDigits?: number): void;
  toMatch(pattern: string | RegExp): void;
  toContain(item: unknown): void;
  toContainEqual(item: unknown): void;
  toHaveLength(n: number): void;
  toHaveProperty(keyPath: string | Array<string | number>, value?: unknown): void;
  toMatchObject(subset: object): void;
  toThrow(expected?: unknown): void;
  toHaveBeenCalled(): void;
  toHaveBeenCalledTimes(n: number): void;
  toHaveBeenCalledWith(...args: unknown[]): void;
  toHaveBeenLastCalledWith(...args: unknown[]): void;
  toHaveBeenNthCalledWith(n: number, ...args: unknown[]): void;
  toHaveReturned(): void;
  toHaveReturnedTimes(n: number): void;
  toHaveReturnedWith(value: unknown): void;
  toHaveLastReturnedWith(value: unknown): void;
  toHaveNthReturnedWith(n: number, value: unknown): void;
  /**
   * Custom matchers use declaration merging instead of a catch-all key, so a
   * typo remains a compile error. Reopen this global interface with the matcher
   * you register through `expect.extend`:
   *
   *   // matchers.d.ts
   *   interface ArgusMatchers {
   *     toBeWithin(low: number, high: number): void;
   *   }
   */
}

/**
 * A matcher registered through `expect.extend`.
 *
 * `this` carries the two things a custom matcher needs from the framework:
 * whether it was reached through `.not`, and the same structural equality
 * `toEqual` uses — so a custom matcher compares values the way the built-in
 * ones do rather than reimplementing it.
 */
type ArgusCustomMatcher = (
  this: { isNot: boolean; equals: (a: unknown, b: unknown) => boolean },
  actual: unknown,
  ...args: unknown[]
) => { pass: boolean; message: () => string };

interface ArgusAsyncMatchers {
  readonly not: ArgusAsyncMatchers;
  readonly resolves: ArgusAsyncMatchers;
  readonly rejects: ArgusAsyncMatchers;
  toBe(expected: unknown): Promise<void>;
  toEqual(expected: unknown): Promise<void>;
  toStrictEqual(expected: unknown): Promise<void>;
  toBeTruthy(): Promise<void>;
  toBeFalsy(): Promise<void>;
  toBeNull(): Promise<void>;
  toBeUndefined(): Promise<void>;
  toBeDefined(): Promise<void>;
  toBeNaN(): Promise<void>;
  toBeGreaterThan(n: number): Promise<void>;
  toBeGreaterThanOrEqual(n: number): Promise<void>;
  toBeLessThan(n: number): Promise<void>;
  toBeLessThanOrEqual(n: number): Promise<void>;
  toBeCloseTo(expected: number, numDigits?: number): Promise<void>;
  toMatch(pattern: string | RegExp): Promise<void>;
  toContain(item: unknown): Promise<void>;
  toContainEqual(item: unknown): Promise<void>;
  toHaveLength(n: number): Promise<void>;
  toHaveProperty(keyPath: string | Array<string | number>, value?: unknown): Promise<void>;
  toMatchObject(subset: object): Promise<void>;
  toThrow(expected?: unknown): Promise<void>;
  toHaveBeenCalled(): Promise<void>;
  toHaveBeenCalledTimes(n: number): Promise<void>;
  toHaveBeenCalledWith(...args: unknown[]): Promise<void>;
  toHaveBeenLastCalledWith(...args: unknown[]): Promise<void>;
  toHaveBeenNthCalledWith(n: number, ...args: unknown[]): Promise<void>;
  toHaveReturned(): Promise<void>;
  toHaveReturnedTimes(n: number): Promise<void>;
  toHaveReturnedWith(value: unknown): Promise<void>;
  toHaveLastReturnedWith(value: unknown): Promise<void>;
  toHaveNthReturnedWith(n: number, value: unknown): Promise<void>;
  /**
   * Reopen this interface too when the custom matcher is used through
   * `.resolves` or `.rejects`.
   */
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface ArgusMockResult {
  type: 'return' | 'throw';
  value: unknown;
}

interface ArgusMockRecord {
  calls: unknown[][];
  results: ArgusMockResult[];
  instances: unknown[];
}

interface ArgusMockFn {
  (...args: unknown[]): unknown;
  mock: ArgusMockRecord;
  mockReturnValue(value: unknown): ArgusMockFn;
  mockReturnValueOnce(value: unknown): ArgusMockFn;
  mockImplementation(fn: (...args: unknown[]) => unknown): ArgusMockFn;
  mockImplementationOnce(fn: (...args: unknown[]) => unknown): ArgusMockFn;
  mockResolvedValue(value: unknown): ArgusMockFn;
  mockRejectedValue(value: unknown): ArgusMockFn;
  mockClear(): ArgusMockFn;
  mockReset(): ArgusMockFn;
  mockRestore?: () => ArgusMockFn;
}

interface ArgusFakeTimersConfig {
  /** Initial fake epoch. Defaults to the real `Date.now()` when fake timers are installed. */
  now?: number | Date;
  /** Maximum callbacks one drain operation may run. Defaults to 100,000. */
  timerLimit?: number;
}

interface ArgusNamespace {
  /** Create a mock function, optionally backed by an implementation. */
  fn(impl?: (...args: unknown[]) => unknown): ArgusMockFn;
  /** Replace a method with a mock that records calls and can be restored. */
  spyOn(obj: Record<string, unknown>, method: string | number | symbol): ArgusMockFn;
  /** Register a fake for a React Native native module, by module name. */
  mockNativeModule(name: string, factory: () => unknown): void;
  /** Drop every registered native-module fake. */
  resetNativeModules(): void;
  /** Replace Date and timer globals with a manually controlled clock. */
  useFakeTimers(config?: ArgusFakeTimersConfig): ArgusNamespace;
  /** Restore the timer globals captured before user code ran. */
  useRealTimers(): ArgusNamespace;
  /** Advance fake time and run every timer due within that interval. */
  advanceTimersByTime(ms: number): ArgusNamespace;
  /** Advance fake time; V1 drains promises while legacy grants 100 real turns between timers. */
  advanceTimersByTimeAsync(ms: number): Promise<void>;
  /** Run pending timers recursively until none remain or timerLimit is reached. */
  runAllTimers(): ArgusNamespace;
  /** Run through the latest due time pending at the start, including new timers inside it. */
  runOnlyPendingTimers(): ArgusNamespace;
  /** Remove pending timers and reset fake time to its installation value. */
  clearAllTimers(): ArgusNamespace;
  /** Number of pending fake timeouts and intervals. */
  getTimerCount(): number;
  /** Change fake wall time without changing the remaining delay of pending timers. */
  setSystemTime(now?: number | Date): ArgusNamespace;
  /** Read the real wall clock even while Date is fake. */
  getRealSystemTime(): number;
}

// ---------------------------------------------------------------------------
// Test registration
// ---------------------------------------------------------------------------

type ArgusTestFn = () => void | Promise<unknown>;
type ArgusHookFn = () => void | Promise<unknown>;

interface ArgusDescribe {
  (name: string, fn: () => void): void;
  /** Register the suite but do not run it. */
  skip(name: string, fn: () => void): void;
  /** Run only focused suites and tests in this file. */
  only(name: string, fn: () => void): void;
}

interface ArgusTest {
  (name: string, fn?: ArgusTestFn): void;
  /** Register the test but do not run it. */
  skip(name: string, fn?: ArgusTestFn): void;
  /** Run only focused suites and tests in this file. */
  only(name: string, fn: ArgusTestFn): void;
  /** Record the test as planned. The body, if given, is never run. */
  todo(name: string, fn?: ArgusTestFn): void;
}

/**
 * `expect` is a callable with statics bolted onto it, so it needs an interface
 * rather than a bare function type. Declaring only the call signature drops
 * `extend`, `assertions` and `hasAssertions` — all three implemented and
 * documented — and every use of them becomes a type error against a package
 * that supports them.
 */
interface ArgusExpect {
  (actual: unknown): ArgusMatchers;
  /**
   * Register custom matchers. They become available on `expect(...)` and on
   * `.not`, and count towards `expect.assertions` like any built-in one.
   */
  extend(matchers: Record<string, ArgusCustomMatcher>): void;
  /**
   * Require exactly `n` assertions to run in this test. Guards a test whose
   * assertions live in a callback that might never be reached.
   */
  assertions(n: number): void;
  /** Require at least one assertion to run in this test. */
  hasAssertions(): void;
}

declare const describe: ArgusDescribe;
declare const test: ArgusTest;
declare const it: ArgusTest;
declare const expect: ArgusExpect;
declare const beforeAll: (fn: ArgusHookFn) => void;
declare const afterAll: (fn: ArgusHookFn) => void;
declare const beforeEach: (fn: ArgusHookFn) => void;
declare const afterEach: (fn: ArgusHookFn) => void;
declare const argus: ArgusNamespace;

// ---------------------------------------------------------------------------
// The virtual `argus` module — component testing
// ---------------------------------------------------------------------------

declare module 'argus' {
  /**
   * A rendered host element: the tree Argus asserts against.
   *
   * A node is a live view of the element, not a copy of it. Holding one across
   * an update is safe — every property reads the current render, so a retained
   * handle fires the current handler and reports the current props.
   *
   * The properties are `readonly` because Argus exposes getter-only views of
   * `test-renderer`'s mutable host-instance object. React's reconciler updates
   * that object; a write to the Argus wrapper cannot reach it and would be
   * discarded without an error.
   */
  export interface HostNode {
    readonly type: string;
    readonly props: Record<string, unknown>;
    readonly parent: HostNode | null;
    readonly children: HostChild[];
  }

  /** A child of a host element — either another element or a text run. */
  export type HostChild = HostNode | string;

  /** Queries accept an exact string or a regular expression. */
  export type QueryMatcher = string | RegExp;

  /** Millisecond-shaped polling options shared by async component utilities. */
  export interface WaitForOptions {
    /** Wall-clock ceiling. Defaults to 1000 ms. */
    timeout?: number;
    /** Requested delay between retries. Defaults to 50 ms. */
    interval?: number;
  }

  /**
   * Queries bound to a subtree.
   *
   * `getBy*` throws when there is no match, or more than one. `queryBy*` returns
   * null instead of throwing, which is how you assert absence. The `All`
   * variants return every match.
   */
  export interface BoundQueries {
    readonly root: HostNode;
    getByText(value: QueryMatcher): HostNode;
    getAllByText(value: QueryMatcher): HostNode[];
    queryByText(value: QueryMatcher): HostNode | null;
    queryAllByText(value: QueryMatcher): HostNode[];
    findByText(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode>;
    findAllByText(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode[]>;
    getByTestId(value: QueryMatcher): HostNode;
    getAllByTestId(value: QueryMatcher): HostNode[];
    queryByTestId(value: QueryMatcher): HostNode | null;
    queryAllByTestId(value: QueryMatcher): HostNode[];
    findByTestId(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode>;
    findAllByTestId(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode[]>;
    getByRole(value: QueryMatcher): HostNode;
    getAllByRole(value: QueryMatcher): HostNode[];
    queryByRole(value: QueryMatcher): HostNode | null;
    queryAllByRole(value: QueryMatcher): HostNode[];
    findByRole(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode>;
    findAllByRole(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode[]>;
    getByPlaceholderText(value: QueryMatcher): HostNode;
    getAllByPlaceholderText(value: QueryMatcher): HostNode[];
    queryByPlaceholderText(value: QueryMatcher): HostNode | null;
    queryAllByPlaceholderText(value: QueryMatcher): HostNode[];
    findByPlaceholderText(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode>;
    findAllByPlaceholderText(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode[]>;
    getByDisplayValue(value: QueryMatcher): HostNode;
    getAllByDisplayValue(value: QueryMatcher): HostNode[];
    queryByDisplayValue(value: QueryMatcher): HostNode | null;
    queryAllByDisplayValue(value: QueryMatcher): HostNode[];
    findByDisplayValue(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode>;
    findAllByDisplayValue(value: QueryMatcher, options?: WaitForOptions): Promise<HostNode[]>;
  }

  /** What `render` hands back for the tree it just mounted. */
  export interface RenderResult extends BoundQueries {
    readonly root: HostNode;
    /** Re-render the same root with a new element. */
    rerender(element: unknown): void;
    /** Unmount the tree. Argus also does this automatically after each test. */
    unmount(): void;
  }

  /**
   * Mount a React element and return the host tree.
   *
   * Synchronous: the render is flushed before this returns, so the tree can be
   * asserted on the next line. Every render is unmounted after the test that
   * created it, with no cleanup call needed.
   */
  export function render(element: unknown): RenderResult;

  /** Queries bound to the most recent render. */
  export const screen: BoundQueries;

  /** Queries bound to `node`'s subtree, for scoping a search. */
  export function within(node: HostNode): BoundQueries;

  /**
   * Retry until `expectation` stops throwing or its returned promise resolves.
   *
   * Standalone Hermes does not honor timer delays, so Argus applies both the
   * requested wall-clock timeout and a derived scheduler-turn budget. The first
   * exhausted budget rejects with the last callback error plus the budget reason.
   */
  export function waitFor<T>(expectation: () => T, options?: WaitForOptions): Promise<Awaited<T>>;

  /** Wait for an initially-present query result or held host element to disappear. */
  export function waitForElementToBeRemoved<T>(
    callback: () => T,
    options?: WaitForOptions,
  ): Promise<T>;
  export function waitForElementToBeRemoved<T extends HostNode | readonly HostNode[]>(
    element: T,
    options?: WaitForOptions,
  ): Promise<T>;

  /**
   * Dispatch an event to a node's handler and flush the resulting update.
   *
   * `fireEvent(node, 'press')` and `fireEvent.press(node)` are equivalent; the
   * event name is normalised to the `onX` prop.
   */
  export const fireEvent: {
    (node: HostNode, event: string, payload?: unknown): void;
    press(node: HostNode): void;
    changeText(node: HostNode, value: string): void;
  };

  /** Options shared by interactions created with `userEvent.setup()`. */
  export interface UserEventSetupOptions {
    /** Requested delay between interaction steps. Defaults to 0 ms. */
    delay?: number;
    /** Optional timer advancement hook, matching React Native Testing Library. */
    advanceTimers?: (delay: number) => Promise<unknown> | unknown;
  }

  export interface UserEventConfig {
    delay: number;
    advanceTimers(delay: number): Promise<unknown> | unknown;
  }

  export interface PressOptions {
    /** Long-press duration in milliseconds. Defaults to 500 ms. */
    duration?: number;
  }

  export interface TypeOptions {
    skipPress?: boolean;
    submitEditing?: boolean;
    skipBlur?: boolean;
  }

  /** Asynchronous, device-shaped component interactions. */
  export interface UserEventInstance {
    readonly config: UserEventConfig;
    press(node: HostNode): Promise<void>;
    longPress(node: HostNode, options?: PressOptions): Promise<void>;
    type(node: HostNode, text: string, options?: TypeOptions): Promise<void>;
    clear(node: HostNode): Promise<void>;
    paste(node: HostNode, text: string): Promise<void>;
  }

  /**
   * React Native Testing Library-shaped realistic interactions.
   *
   * Every method returns a promise. Prefer a configured `setup()` instance;
   * direct methods remain available for compatibility.
   */
  export const userEvent: {
    setup(options?: UserEventSetupOptions): UserEventInstance;
    press(node: HostNode): Promise<void>;
    longPress(node: HostNode, options?: PressOptions): Promise<void>;
    type(node: HostNode, text: string, options?: TypeOptions): Promise<void>;
    clear(node: HostNode): Promise<void>;
    paste(node: HostNode, text: string): Promise<void>;
  };

  /**
   * Run `callback` inside React's act scope and flush what it schedules.
   *
   * `render`, `rerender` and `fireEvent` already do this. Reach for `act`
   * directly only when state is updated from outside those, such as from a
   * resolved promise or a captured callback.
   */
  export function act(callback: () => void): void;
}
