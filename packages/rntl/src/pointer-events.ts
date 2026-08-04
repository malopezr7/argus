import type { HostNode } from './tree.js';

interface StylePointerEvents {
  found: boolean;
  value?: unknown;
}

function stylePointerEvents(style: unknown): StylePointerEvents {
  if (Array.isArray(style)) {
    let result: StylePointerEvents = { found: false };
    for (let i = 0; i < style.length; i++) {
      const candidate = stylePointerEvents(style[i]);
      if (candidate.found) result = candidate;
    }
    return result;
  }

  if (typeof style !== 'object' || style === null) return { found: false };
  const descriptor = Object.getOwnPropertyDescriptor(style, 'pointerEvents');
  if (descriptor === undefined || !('value' in descriptor)) return { found: false };
  return { found: true, value: descriptor.value };
}

/** Match React Native's pointer target rules, including flattened style values. */
export function isPointerEventEnabled(node: HostNode, isParent = false): boolean {
  const styled = stylePointerEvents(node.props.style);
  const pointerEvents = node.props.pointerEvents ?? (styled.found ? styled.value : undefined);
  const parentCondition = isParent ? pointerEvents === 'box-only' : pointerEvents === 'box-none';

  if (pointerEvents === 'none' || parentCondition) return false;
  return node.parent === null ? true : isPointerEventEnabled(node.parent, true);
}
