/**
 * The host-element view the component API hands to tests.
 *
 * `test-renderer` already exposes a live, identity-stable handle: `TestInstance`
 * reads `type`/`props`/`parent`/`children` through getters onto a mutable
 * instance object, the reconciler replaces `instance.props` in place on commit,
 * and `TestInstance.fromInstance` dedupes through a `WeakMap` so one instance
 * always yields one handle.
 *
 * So this layer's only job is to narrow that handle to the shape Argus
 * documents — it must NOT copy it. Copying is what produced the bug this file
 * exists to prevent: a node read out of a tree snapshot kept the `props` object
 * from the render it was taken at, so a held button re-invoked the closure from
 * a previous render. Pressing a counter twice went 0 -> 1 -> 1, silently,
 * because the second press called `setCount(0 + 1)` again.
 *
 * Every property below is therefore a getter that reads through on access, and
 * every node is cached so identity survives a re-render: `within(scope)` and
 * `node.parent` keep comparing equal to the node the test already holds.
 */

import type { TestInstance, TestNode } from 'test-renderer';

export type HostChild = HostNode | string;

/**
 * A rendered host element.
 *
 * The properties are `readonly` because Argus exposes getter-only views of
 * `test-renderer`'s mutable host-instance object. React's reconciler updates that
 * object in `commitUpdate`; a write to this wrapper cannot reach it, and Hermes
 * discards the assignment without complaining. Declaring the properties writable
 * would invite assignments that silently do nothing.
 */
export interface HostNode {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly parent: HostNode | null;
  readonly children: HostChild[];
}

/**
 * One `HostNode` per `TestInstance`.
 *
 * Keyed on the handle rather than the fiber because `test-renderer` already
 * guarantees handle identity; this map only has to avoid minting a second
 * wrapper for the same one. `WeakMap` is present on both Hermes engines.
 */
const nodes = new WeakMap<TestInstance, HostNode>();

function hostChild(child: TestNode): HostChild {
  return typeof child === 'string' ? child : hostNode(child);
}

/** The live host-element view of `instance`. */
export function hostNode(instance: TestInstance): HostNode {
  const cached = nodes.get(instance);
  if (cached !== undefined) return cached;

  const node: HostNode = {
    get type(): string {
      return instance.type;
    },
    get props(): Record<string, unknown> {
      return instance.props as Record<string, unknown>;
    },
    get parent(): HostNode | null {
      const parent = instance.parent;
      return parent === null ? null : hostNode(parent);
    },
    get children(): HostChild[] {
      const source = instance.children;
      const result: HostChild[] = [];
      for (let i = 0; i < source.length; i++) result[result.length] = hostChild(source[i]);
      return result;
    },
  };

  nodes.set(instance, node);
  return node;
}
