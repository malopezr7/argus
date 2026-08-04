import { type WaitForOptions, waitFor } from './async.js';
import { screen as renderScreen } from './render.js';
import type { HostNode } from './tree.js';

export type QueryMatcher = string | RegExp;

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

type Predicate = (node: HostNode) => boolean;

function matches(actual: unknown, expected: QueryMatcher): boolean {
  if (typeof actual !== 'string') return false;
  if (typeof expected === 'string') return actual === expected;
  expected.lastIndex = 0;
  return RegExp.prototype.test.call(expected, actual);
}

/**
 * Read `children` once per node, never per iteration.
 *
 * It is a live view, so every read materialises a fresh array in O(children).
 * Reading it inside the loop — once for the bound and once for the index — made
 * a single node cost O(children^2), which turned a wide list into a per-file
 * timeout, and a timeout is an infrastructure failure that discards every result
 * in the file. Hoisting keeps the traversal linear without caching anything, so
 * a held node still reads through to the current tree.
 */
function textContent(node: HostNode): string {
  const children = node.children;
  let value = '';
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    value += typeof child === 'string' ? child : textContent(child);
  }
  return value;
}

function collect(root: HostNode, predicate: Predicate): HostNode[] {
  const result: HostNode[] = [];
  function visit(node: HostNode): void {
    if (predicate(node)) result[result.length] = node;
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (typeof child !== 'string') visit(child);
    }
  }
  visit(root);
  return result;
}

function singular(all: HostNode[], label: string, allowMissing: boolean): HostNode | null {
  if (all.length === 0) {
    if (allowMissing) return null;
    throw new Error(`No elements found for ${label}`);
  }
  if (all.length > 1) throw new Error(`Multiple elements found for ${label}`);
  return all[0];
}

function nonEmpty(all: HostNode[], label: string): HostNode[] {
  if (all.length === 0) throw new Error(`No elements found for ${label}`);
  return all;
}

export function makeQueries(resolveRoot: () => HostNode): BoundQueries {
  function all(predicate: Predicate): HostNode[] {
    return collect(resolveRoot(), predicate);
  }
  function text(value: QueryMatcher): HostNode[] {
    return all((node) => node.type === 'Text' && matches(textContent(node), value));
  }
  function testId(value: QueryMatcher): HostNode[] {
    return all((node) => matches(node.props.testID, value));
  }
  function role(value: QueryMatcher): HostNode[] {
    return all((node) => matches(node.props.accessibilityRole ?? node.props.role, value));
  }
  function placeholder(value: QueryMatcher): HostNode[] {
    return all((node) => matches(node.props.placeholder, value));
  }
  function displayValue(value: QueryMatcher): HostNode[] {
    return all((node) => matches(node.props.value ?? node.props.defaultValue, value));
  }

  return {
    get root(): HostNode {
      return resolveRoot();
    },
    getByText: (value) => singular(text(value), 'text', false) as HostNode,
    getAllByText: (value) => nonEmpty(text(value), 'text'),
    queryByText: (value) => singular(text(value), 'text', true),
    queryAllByText: text,
    findByText: (value, options) =>
      waitFor(() => singular(text(value), 'text', false) as HostNode, options),
    findAllByText: (value, options) => waitFor(() => nonEmpty(text(value), 'text'), options),
    getByTestId: (value) => singular(testId(value), 'testID', false) as HostNode,
    getAllByTestId: (value) => nonEmpty(testId(value), 'testID'),
    queryByTestId: (value) => singular(testId(value), 'testID', true),
    queryAllByTestId: testId,
    findByTestId: (value, options) =>
      waitFor(() => singular(testId(value), 'testID', false) as HostNode, options),
    findAllByTestId: (value, options) => waitFor(() => nonEmpty(testId(value), 'testID'), options),
    getByRole: (value) => singular(role(value), 'role', false) as HostNode,
    getAllByRole: (value) => nonEmpty(role(value), 'role'),
    queryByRole: (value) => singular(role(value), 'role', true),
    queryAllByRole: role,
    findByRole: (value, options) =>
      waitFor(() => singular(role(value), 'role', false) as HostNode, options),
    findAllByRole: (value, options) => waitFor(() => nonEmpty(role(value), 'role'), options),
    getByPlaceholderText: (value) =>
      singular(placeholder(value), 'placeholder text', false) as HostNode,
    getAllByPlaceholderText: (value) => nonEmpty(placeholder(value), 'placeholder text'),
    queryByPlaceholderText: (value) => singular(placeholder(value), 'placeholder text', true),
    queryAllByPlaceholderText: placeholder,
    findByPlaceholderText: (value, options) =>
      waitFor(() => singular(placeholder(value), 'placeholder text', false) as HostNode, options),
    findAllByPlaceholderText: (value, options) =>
      waitFor(() => nonEmpty(placeholder(value), 'placeholder text'), options),
    getByDisplayValue: (value) => singular(displayValue(value), 'display value', false) as HostNode,
    getAllByDisplayValue: (value) => nonEmpty(displayValue(value), 'display value'),
    queryByDisplayValue: (value) => singular(displayValue(value), 'display value', true),
    queryAllByDisplayValue: displayValue,
    findByDisplayValue: (value, options) =>
      waitFor(() => singular(displayValue(value), 'display value', false) as HostNode, options),
    findAllByDisplayValue: (value, options) =>
      waitFor(() => nonEmpty(displayValue(value), 'display value'), options),
  };
}

/** Attach live queries to another object whose `root` is itself a live getter. */
export function bindQueries<T extends { readonly root: HostNode }>(target: T): T & BoundQueries {
  const queries = makeQueries(() => target.root);
  const names = Object.getOwnPropertyNames(queries);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name === 'root') continue;
    const descriptor = Object.getOwnPropertyDescriptor(queries, name);
    if (descriptor !== undefined) Object.defineProperty(target, name, descriptor);
  }
  return target as T & BoundQueries;
}

export const screen = makeQueries(() => renderScreen.root);

export function within(node: HostNode): BoundQueries {
  return makeQueries(() => node);
}
