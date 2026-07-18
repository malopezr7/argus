import { screen as renderScreen } from './render.js';
import type { HostNode } from './tree.js';

export type QueryMatcher = string | RegExp;

export interface BoundQueries {
  readonly root: HostNode;
  getByText(value: QueryMatcher): HostNode;
  getAllByText(value: QueryMatcher): HostNode[];
  queryByText(value: QueryMatcher): HostNode | null;
  queryAllByText(value: QueryMatcher): HostNode[];
  getByTestId(value: QueryMatcher): HostNode;
  getAllByTestId(value: QueryMatcher): HostNode[];
  queryByTestId(value: QueryMatcher): HostNode | null;
  queryAllByTestId(value: QueryMatcher): HostNode[];
  getByRole(value: QueryMatcher): HostNode;
  getAllByRole(value: QueryMatcher): HostNode[];
  queryByRole(value: QueryMatcher): HostNode | null;
  queryAllByRole(value: QueryMatcher): HostNode[];
  getByPlaceholderText(value: QueryMatcher): HostNode;
  getAllByPlaceholderText(value: QueryMatcher): HostNode[];
  queryByPlaceholderText(value: QueryMatcher): HostNode | null;
  queryAllByPlaceholderText(value: QueryMatcher): HostNode[];
  getByDisplayValue(value: QueryMatcher): HostNode;
  getAllByDisplayValue(value: QueryMatcher): HostNode[];
  queryByDisplayValue(value: QueryMatcher): HostNode | null;
  queryAllByDisplayValue(value: QueryMatcher): HostNode[];
}

type Predicate = (node: HostNode) => boolean;

function matches(actual: unknown, expected: QueryMatcher): boolean {
  if (typeof actual !== 'string') return false;
  if (typeof expected === 'string') return actual === expected;
  expected.lastIndex = 0;
  return RegExp.prototype.test.call(expected, actual);
}

function textContent(node: HostNode): string {
  let value = '';
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    value += typeof child === 'string' ? child : textContent(child);
  }
  return value;
}

function collect(root: HostNode, predicate: Predicate): HostNode[] {
  const result: HostNode[] = [];
  function visit(node: HostNode): void {
    if (predicate(node)) result[result.length] = node;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
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

function makeQueries(resolveRoot: () => HostNode): BoundQueries {
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
    getByTestId: (value) => singular(testId(value), 'testID', false) as HostNode,
    getAllByTestId: (value) => nonEmpty(testId(value), 'testID'),
    queryByTestId: (value) => singular(testId(value), 'testID', true),
    queryAllByTestId: testId,
    getByRole: (value) => singular(role(value), 'role', false) as HostNode,
    getAllByRole: (value) => nonEmpty(role(value), 'role'),
    queryByRole: (value) => singular(role(value), 'role', true),
    queryAllByRole: role,
    getByPlaceholderText: (value) =>
      singular(placeholder(value), 'placeholder text', false) as HostNode,
    getAllByPlaceholderText: (value) => nonEmpty(placeholder(value), 'placeholder text'),
    queryByPlaceholderText: (value) => singular(placeholder(value), 'placeholder text', true),
    queryAllByPlaceholderText: placeholder,
    getByDisplayValue: (value) => singular(displayValue(value), 'display value', false) as HostNode,
    getAllByDisplayValue: (value) => nonEmpty(displayValue(value), 'display value'),
    queryByDisplayValue: (value) => singular(displayValue(value), 'display value', true),
    queryAllByDisplayValue: displayValue,
  };
}

export const screen = makeQueries(() => renderScreen.root);

export function within(node: HostNode): BoundQueries {
  return makeQueries(() => node);
}
