import React from 'react';
import type { HostNode } from './tree.js';

type EventHandler = (payload?: unknown) => unknown;

export interface FireEvent {
  (node: HostNode, event: string, payload?: unknown): void;
  press(node: HostNode): void;
  changeText(node: HostNode, value: string): void;
}

function handlerName(event: string): string {
  if (event.startsWith('on')) return event;
  return `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
}

function accessibilityDisabled(node: HostNode): boolean {
  const state = node.props.accessibilityState as { disabled?: unknown } | null | undefined;
  return (
    node.props.disabled === true ||
    (state !== null && typeof state === 'object' && state.disabled === true)
  );
}

function isDisabled(node: HostNode, name: string): boolean {
  if (accessibilityDisabled(node)) return true;
  return name === 'onChangeText' && node.props.editable === false;
}

function findHandler(
  node: HostNode,
  name: string,
): { handler: EventHandler; node: HostNode } | null {
  let current: HostNode | null = node;
  while (current !== null) {
    const candidate = current.props[name];
    if (typeof candidate === 'function') {
      return { handler: candidate as EventHandler, node: current };
    }
    current = current.parent;
  }
  return null;
}

function dispatch(node: HostNode, event: string, payload?: unknown): void {
  const name = handlerName(event);
  const resolved = findHandler(node, name);
  if (resolved === null) throw new Error(`No handler found for ${name}`);
  if (isDisabled(resolved.node, name)) return;

  // `React.act` flushes the update before returning, and host nodes read through
  // to the fiber, so the committed tree is already visible to every node the
  // test holds — including `node` itself. Nothing has to be re-materialized.
  React.act(() => {
    resolved.handler(payload);
  });
}

export const fireEvent: FireEvent = Object.assign(dispatch, {
  press(node: HostNode): void {
    dispatch(node, 'press');
  },
  changeText(node: HostNode, value: string): void {
    dispatch(node, 'changeText', value);
  },
});
