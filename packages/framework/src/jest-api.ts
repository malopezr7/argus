/**
 * @arguslab/framework — Jest-API compatibility surface.
 *
 * Module boundary: this module OWNS the registry state and the
 * full registration API. index.ts imports ONE-WAY from here; no back-imports.
 *
 * Hermes 0.17 envelope rules:
 *  - No async arrows (async () =>) — use named async function declarations.
 *  - No for..of, no spread.
 *  - Index loops only.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookFn = () => void | Promise<unknown>;
export type TestFn = () => void | Promise<unknown>;

export interface PendingTest {
  kind: 'test';
  name: string;
  fn?: TestFn;
  mode?: 'skip' | 'only' | 'todo';
}

export interface PendingSuite {
  kind: 'suite';
  name: string;
  children: PendingNode[];
  beforeAll: HookFn[];
  afterAll: HookFn[];
  beforeEach: HookFn[];
  afterEach: HookFn[];
  mode?: 'skip' | 'only';
}

export type PendingNode = PendingTest | PendingSuite;

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

let rootChildren: PendingNode[] = [];
let currentSuite: PendingSuite | null = null;

// Append without Array.prototype.push (immune to push pollution).
export function append<T>(arr: T[], item: T): void {
  arr[arr.length] = item;
}

export function getRootChildren(): PendingNode[] {
  return rootChildren;
}

export function resetRegistry(): void {
  rootChildren = [];
  currentSuite = null;
}

// ---------------------------------------------------------------------------
// requireSuite helper — throws when a hook is registered outside describe()
// ---------------------------------------------------------------------------

function requireSuite(): PendingSuite {
  if (currentSuite === null) {
    throw new Error('Hook called outside of describe()');
  }
  return currentSuite;
}

// ---------------------------------------------------------------------------
// describe + test registration
// ---------------------------------------------------------------------------

export function describe(name: string, fn: () => void): void {
  const suite: PendingSuite = {
    kind: 'suite',
    name,
    children: [],
    beforeAll: [],
    afterAll: [],
    beforeEach: [],
    afterEach: [],
  };
  append(currentSuite ? currentSuite.children : rootChildren, suite);
  const parent = currentSuite;
  currentSuite = suite;
  try {
    fn();
  } finally {
    currentSuite = parent;
  }
}

describe.skip = function describeSkip(name: string, fn: () => void): void {
  const suite: PendingSuite = {
    kind: 'suite',
    name,
    children: [],
    beforeAll: [],
    afterAll: [],
    beforeEach: [],
    afterEach: [],
    mode: 'skip',
  };
  append(currentSuite ? currentSuite.children : rootChildren, suite);
  const parent = currentSuite;
  currentSuite = suite;
  try {
    fn();
  } finally {
    currentSuite = parent;
  }
};

describe.only = function describeOnly(name: string, fn: () => void): void {
  const suite: PendingSuite = {
    kind: 'suite',
    name,
    children: [],
    beforeAll: [],
    afterAll: [],
    beforeEach: [],
    afterEach: [],
    mode: 'only',
  };
  append(currentSuite ? currentSuite.children : rootChildren, suite);
  const parent = currentSuite;
  currentSuite = suite;
  try {
    fn();
  } finally {
    currentSuite = parent;
  }
};

export function test(name: string, fn?: TestFn): void {
  if (!currentSuite) {
    throw new Error(`test("${name}") called outside of describe()`);
  }
  append(currentSuite.children, { kind: 'test', name, fn });
}

test.skip = function testSkip(name: string, fn?: TestFn): void {
  if (!currentSuite) {
    throw new Error(`test.skip("${name}") called outside of describe()`);
  }
  append(currentSuite.children, { kind: 'test', name, fn, mode: 'skip' });
};

test.only = function testOnly(name: string, fn: TestFn): void {
  if (!currentSuite) {
    throw new Error(`test.only("${name}") called outside of describe()`);
  }
  append(currentSuite.children, { kind: 'test', name, fn, mode: 'only' });
};

test.todo = function testTodo(name: string, _fn?: TestFn): void {
  if (!currentSuite) {
    throw new Error(`test.todo("${name}") called outside of describe()`);
  }
  // test.todo accepts an optional body, which is registered but never executed
  append(currentSuite.children, { kind: 'test', name, mode: 'todo' });
};

// it is referentially identical to test
export const it: typeof test = test;

// ---------------------------------------------------------------------------
// Hook registrars
// ---------------------------------------------------------------------------

export function beforeAll(fn: HookFn): void {
  append(requireSuite().beforeAll, fn);
}

export function afterAll(fn: HookFn): void {
  append(requireSuite().afterAll, fn);
}

export function beforeEach(fn: HookFn): void {
  append(requireSuite().beforeEach, fn);
}

export function afterEach(fn: HookFn): void {
  append(requireSuite().afterEach, fn);
}

// ---------------------------------------------------------------------------
// Focus-resolution helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a node is effectively skipped — either by its own mode
 * or by an ancestor having mode 'skip'. Skip is resolved FIRST and wins
 * transitively.
 */
export function effectivelySkipped(node: PendingNode, ancestorSkipped: boolean): boolean {
  if (ancestorSkipped) return true;
  return node.mode === 'skip';
}

/**
 * Walk the tree (index loops) and return true if any NON-effectively-skipped
 * node has mode === 'only'. effectivelySkipped is propagated top-down.
 */
export function computeHasOnly(nodes: PendingNode[], ancestorSkipped: boolean): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const skipped = effectivelySkipped(node, ancestorSkipped);
    if (!skipped && node.mode === 'only') return true;
    if (node.kind === 'suite') {
      if (computeHasOnly(node.children, skipped)) return true;
    }
  }
  return false;
}

/**
 * Walk the subtree of a single suite and return true if any non-effectively-
 * skipped descendant has mode === 'only'. Used by included() to keep ancestors
 * on the path.
 */
export function subtreeHasOnly(suite: PendingSuite, ancestorSkipped: boolean): boolean {
  const skipped = effectivelySkipped(suite, ancestorSkipped);
  return computeHasOnly(suite.children, skipped);
}

/**
 * PINNED inclusion predicate.
 *
 * Returns true iff the node should be executed (or, for suites, descended into).
 *
 * @param node              The candidate node.
 * @param ancestorSkipped   True if any ancestor is effectively skipped.
 * @param ancestorsHaveOnly True if an ancestor suite has mode 'only'.
 * @param hasOnly           File-global: any non-skipped node has mode 'only'.
 */
export function included(
  node: PendingNode,
  ancestorSkipped: boolean,
  ancestorsHaveOnly: boolean,
  hasOnly: boolean,
): boolean {
  // Step 1: skip wins transitively.
  if (effectivelySkipped(node, ancestorSkipped)) return false;

  if (!hasOnly) {
    // No focus anywhere — run everything that isn't skipped.
    return true;
  }

  // --- hasOnly === true ---

  // Self is explicitly focused.
  if (node.mode === 'only') return true;

  // Inherited selection from an ancestor .only describe.
  if (ancestorsHaveOnly) return true;

  // A test not in an .only ancestry: silenced unless a deeper .only is in a
  // SUITE subtree and keeps this suite on the path.
  if (node.kind === 'suite') {
    return subtreeHasOnly(node, ancestorSkipped);
  }

  // This test is not on any .only path.
  return false;
}

// ---------------------------------------------------------------------------
// Global install
// ---------------------------------------------------------------------------

export function installGlobals(g: Record<string, unknown>): void {
  g.describe = describe;
  g.test = test;
  g.it = it;
  g.beforeAll = beforeAll;
  g.afterAll = afterAll;
  g.beforeEach = beforeEach;
  g.afterEach = afterEach;
}
