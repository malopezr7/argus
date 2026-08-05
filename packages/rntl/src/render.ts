import React from 'react';
import { createRoot, type Root } from 'test-renderer';
import { type HostNode, hostNode } from './tree.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A mounted root.
 *
 * There is no cached tree here on purpose. The root is derived from
 * `renderer.container` on every read, so an update is visible through nodes the
 * test already holds instead of only through a freshly queried one.
 *
 * `detached` is the exception, and only after unmount: `test-renderer` throws on
 * `.container` once a root is unmounted, so the empty tree a test can still read
 * from `render(...).root` has to be held here instead of derived.
 */
interface ActiveRender {
  renderer: Root;
  mounted: boolean;
  detached: HostNode | null;
}

/**
 * Root shape cannot signal detachment: live containers also have `type === ''`
 * and `parent === null`. Only the unmount path adds roots to this identity set.
 */
const detachedRoots = new WeakSet<HostNode>();

function markDetachedRoot(root: HostNode): HostNode {
  detachedRoots.add(root);
  return root;
}

/** Whether `root` belongs to a render whose unmount path has started. */
export function isDetachedRenderRoot(root: HostNode): boolean {
  return detachedRoots.has(root);
}

/** The tree of an unmounted root: nothing, in the shape of an empty container. */
function detachedRoot(): HostNode {
  return markDetachedRoot({ type: '', props: {}, parent: null, children: [] });
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

function remove(record: ActiveRender): void {
  const index = activeRenders.indexOf(record);
  if (index >= 0) activeRenders.splice(index, 1);
}

function unmountRecord(record: ActiveRender): void {
  if (!record.mounted) return;
  const liveRoot = hostNode(record.renderer.container);
  // Detach BEFORE unmounting. `test-renderer` clears its container as soon as
  // `unmount()` is called, while React flushes the cleanup effects after it
  // returns — so a cleanup effect that reads a root would hit the cleared
  // container. Flipping first means it reads the detached tree instead of
  // throwing, and re-entrant unmounts hit the guard above.
  record.mounted = false;
  markDetachedRoot(liveRoot);
  record.detached = detachedRoot();
  try {
    React.act(() => record.renderer.unmount());
  } finally {
    // Leave the list even when the unmount throws. The record has to stay in it
    // for the duration of the unmount — a cleanup effect reading a root has to
    // resolve to this record's detached tree — but `mounted` is already false,
    // so every later `unmountRecord` returns at the guard above without ever
    // reaching here. Stranding it would make it unremovable, and the loop below
    // would spin forever on a list that never shrinks.
    remove(record);
  }
}

export function cleanupActiveRenders(): void {
  let failure: unknown;
  let failed = false;
  // Each pass removes the last record whether or not its teardown threw, so the
  // list strictly shrinks and this terminates. A throw is remembered rather than
  // propagated immediately: bailing out here would leave the renders behind the
  // failing one mounted, and the next test would resolve `screen` against one.
  while (activeRenders.length > 0) {
    try {
      unmountRecord(activeRenders[activeRenders.length - 1]);
    } catch (error) {
      if (!failed) {
        failed = true;
        failure = error;
      }
    }
  }
  if (failed) throw failure;
}

export const screen = {
  get root(): HostNode {
    const record = latestRender();
    return record.detached ?? hostNode(record.renderer.container);
  },
};

export function render(element: React.ReactElement): RenderResult {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  const record: ActiveRender = { renderer, mounted: true, detached: null };

  React.act(() => renderer.render(element));
  activeRenders.push(record);

  return {
    get root(): HostNode {
      return record.detached ?? hostNode(renderer.container);
    },
    rerender(nextElement: React.ReactElement): void {
      if (!record.mounted) throw new Error('Cannot rerender an unmounted component');
      React.act(() => renderer.render(nextElement));
    },
    unmount(): void {
      unmountRecord(record);
    },
  };
}
