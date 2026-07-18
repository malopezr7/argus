import React from 'react';
import { createRoot, type Root } from 'test-renderer';
import { type HostNode, materializeTree } from './tree.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface ActiveRender {
  renderer: Root;
  tree: HostNode;
  mounted: boolean;
}

export interface RenderResult {
  readonly root: HostNode;
  rerender(element: React.ReactElement): void;
  unmount(): void;
}

const activeRenders: ActiveRender[] = [];

function latestRender(): ActiveRender {
  const latest = activeRenders[activeRenders.length - 1];
  if (latest === undefined) throw new Error('No active component render');
  return latest;
}

function refresh(record: ActiveRender): void {
  record.tree = materializeTree(record.renderer.container);
}

export function refreshActiveRenders(): void {
  for (let i = 0; i < activeRenders.length; i++) refresh(activeRenders[i]);
}

function remove(record: ActiveRender): void {
  const index = activeRenders.indexOf(record);
  if (index >= 0) activeRenders.splice(index, 1);
}

function unmountRecord(record: ActiveRender): void {
  if (!record.mounted) return;
  React.act(() => record.renderer.unmount());
  record.mounted = false;
  record.tree = { type: '', props: {}, parent: null, children: [] };
  remove(record);
}

export function cleanupActiveRenders(): void {
  while (activeRenders.length > 0) unmountRecord(activeRenders[activeRenders.length - 1]);
}

export const screen = {
  get root(): HostNode {
    return latestRender().tree;
  },
};

export function render(element: React.ReactElement): RenderResult {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  const record: ActiveRender = {
    renderer,
    tree: materializeTree(renderer.container),
    mounted: true,
  };

  React.act(() => renderer.render(element));
  refresh(record);
  activeRenders.push(record);

  return {
    get root(): HostNode {
      return record.tree;
    },
    rerender(nextElement: React.ReactElement): void {
      if (!record.mounted) throw new Error('Cannot rerender an unmounted component');
      React.act(() => renderer.render(nextElement));
      refresh(record);
    },
    unmount(): void {
      unmountRecord(record);
    },
  };
}
