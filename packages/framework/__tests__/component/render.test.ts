import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '../../src/component/render.js';

function textContent(): string {
  const host = screen.root.children[0];
  if (typeof host === 'string') throw new Error('Expected host node');
  const value = host.children[0];
  if (typeof value !== 'string') throw new Error('Expected text child');
  return value;
}

describe('component render lifecycle', () => {
  it('renders synchronously and replaces the screen tree on rerender', () => {
    const result = render(React.createElement('Text', null, 'old'));
    expect(textContent()).toBe('old');

    result.rerender(React.createElement('Text', null, 'new'));

    expect(textContent()).toBe('new');
    expect(result.root).toBe(screen.root);
    result.unmount();
  });

  it('targets the latest active render and falls back after unmount', () => {
    const first = render(React.createElement('Text', null, 'first'));
    const second = render(React.createElement('Text', null, 'second'));
    expect(textContent()).toBe('second');

    second.unmount();

    expect(textContent()).toBe('first');
    first.unmount();
    expect(() => screen.root).toThrow('No active component render');
  });
});
