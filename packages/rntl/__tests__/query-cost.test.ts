import { describe, expect, it } from 'vitest';
import { within } from '../src/queries.js';
import type { HostChild, HostNode } from '../src/tree.js';

/**
 * `children` is a live view: it materialises a fresh array on every read, and it
 * has to, or a held node would stop tracking the tree.
 *
 * That makes every read O(children). A traversal that reads it once per loop
 * *iteration* — once for the bound, once for the index — therefore costs
 * O(children^2) on a single node, which is what turned a wide list into a
 * per-file timeout. These tests pin the access pattern rather than a duration:
 * a traversal must read each node's `children` a fixed number of times, so the
 * count cannot grow with the width of the node.
 */
function countingLeaf(count: () => void, testID: string): HostNode {
  return {
    type: 'Text',
    props: { testID },
    parent: null,
    get children(): HostChild[] {
      count();
      return [];
    },
  };
}

function countingParent(count: () => void, kids: HostChild[]): HostNode {
  return {
    type: 'View',
    props: {},
    parent: null,
    get children(): HostChild[] {
      count();
      return kids.slice();
    },
  };
}

describe('query traversal cost', () => {
  it('reads each node children once when collecting matches', () => {
    const width = 50;
    let reads = 0;
    const count = (): void => {
      reads++;
    };
    const kids: HostChild[] = [];
    for (let i = 0; i < width; i++) kids[kids.length] = countingLeaf(count, 'leaf');

    const found = within(countingParent(count, kids)).queryAllByTestId('leaf');

    expect(found.length).toBe(width);
    // One read for the parent, one for each leaf. Anything proportional to
    // width * width means the traversal is re-materialising per iteration.
    expect(reads).toBe(1 + width);
  });

  it('does not read one node children more often as that node gets wider', () => {
    // Only the wide node's own reads count here. Each of its reads costs
    // O(width) to materialise, so a read count that grows with width is the
    // quadratic term; the per-leaf reads are linear either way and would mask it.
    function parentReadsAt(width: number): number {
      let reads = 0;
      const noop = (): void => {};
      const kids: HostChild[] = [];
      for (let i = 0; i < width; i++) kids[kids.length] = countingLeaf(noop, 'leaf');
      within(
        countingParent(() => {
          reads++;
        }, kids),
      ).queryAllByTestId('leaf');
      return reads;
    }

    expect(parentReadsAt(100)).toBe(1);
    expect(parentReadsAt(200)).toBe(1);
  });

  it('reads children once per node when matching text content', () => {
    const width = 40;
    let reads = 0;
    const kids: HostChild[] = [];
    for (let i = 0; i < width; i++) kids[kids.length] = 'a';
    const node: HostNode = {
      type: 'Text',
      props: {},
      parent: null,
      get children(): HostChild[] {
        reads++;
        return kids.slice();
      },
    };

    const found = within(node).queryAllByText('a'.repeat(width));

    expect(found.length).toBe(1);
    // One read to build the text, one to walk into the children.
    expect(reads).toBe(2);
  });
});
