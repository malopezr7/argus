import type { TestInstance } from 'test-renderer';

export type HostChild = HostNode | string;

export interface HostNode {
  type: string;
  props: Record<string, unknown>;
  parent: HostNode | null;
  children: HostChild[];
}

function materializeNode(instance: TestInstance, parent: HostNode | null): HostNode {
  const node: HostNode = {
    type: instance.type,
    props: instance.props as Record<string, unknown>,
    parent,
    children: [],
  };

  for (let i = 0; i < instance.children.length; i++) {
    const child = instance.children[i];
    node.children[node.children.length] =
      typeof child === 'string' ? child : materializeNode(child, node);
  }

  return node;
}

export function materializeTree(container: TestInstance): HostNode {
  return materializeNode(container, null);
}
