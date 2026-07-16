import React from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it } from 'vitest';
import { materializeTree } from '../../src/component/tree.js';

describe('materializeTree', () => {
  it('creates linked host-only nodes through composite components', () => {
    function Label(props: { value: string }): React.ReactElement {
      return React.createElement('Text', { testID: 'label' }, props.value);
    }

    const renderer = createRoot({ textComponentTypes: ['Text'] });
    React.act(() => {
      renderer.render(
        React.createElement(
          'View',
          { testID: 'container' },
          React.createElement(Label, { value: 'hello' }),
        ),
      );
    });

    const tree = materializeTree(renderer.container);
    const view = tree.children[0];
    if (typeof view === 'string') throw new Error('Expected View host');
    const text = view.children[0];
    if (typeof text === 'string') throw new Error('Expected Text host');

    expect([tree.type, view.type, text.type]).toEqual(['', 'View', 'Text']);
    expect(text.children).toEqual(['hello']);
    expect(text.parent).toBe(view);
    expect(view.parent).toBe(tree);
  });

  it('materializes an empty container without phantom children', () => {
    const renderer = createRoot();
    React.act(() => renderer.render(React.createElement(React.Fragment)));

    const tree = materializeTree(renderer.container);

    expect(tree.type).toBe('');
    expect(tree.children).toEqual([]);
    expect(tree.parent).toBeNull();
  });
});
