import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '../src/render.js';

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

  it('leaves the result root readable and empty after unmount', () => {
    const result = render(React.createElement('Text', null, 'gone'));

    result.unmount();

    expect(result.root.children).toEqual([]);
    expect(result.root.type).toBe('');
    expect(result.root.parent).toBeNull();
  });

  it('serves the detached root to a cleanup effect running during unmount', () => {
    let observed = 'never ran';
    function Probe(): React.ReactElement {
      React.useEffect(() => {
        return () => {
          observed = `type=${JSON.stringify(screen.root.type)}`;
        };
      }, []);
      return React.createElement('Text', null, 'x');
    }

    render(React.createElement(Probe)).unmount();

    expect(observed).toBe('type=""');
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
