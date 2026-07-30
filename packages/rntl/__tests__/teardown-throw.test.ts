import React from 'react';
import { describe, expect, it } from 'vitest';
import { cleanupActiveRenders, render, screen } from '../src/render.js';

/**
 * A component whose unmount effect cleanup throws.
 *
 * `React.act(() => renderer.unmount())` propagates it, so every teardown path
 * below fails partway through — which is the point. A record that does not
 * survive its own failed teardown is the invariant these tests pin.
 */
function ThrowsOnCleanup(): React.ReactElement {
  React.useEffect(() => {
    return () => {
      throw new Error('cleanup exploded');
    };
  }, []);
  return React.createElement('Text', null, 'x');
}

describe('a render whose teardown throws', () => {
  it('still leaves the active-render list, so the next read falls back', () => {
    const result = render(React.createElement(ThrowsOnCleanup));

    expect(() => result.unmount()).toThrow('cleanup exploded');

    expect(() => screen.root).toThrow('No active component render');
  });

  it('lets cleanup terminate instead of spinning on an unremovable record', () => {
    const result = render(React.createElement(ThrowsOnCleanup));
    expect(() => result.unmount()).toThrow('cleanup exploded');

    cleanupActiveRenders();

    expect(() => screen.root).toThrow('No active component render');
  });

  it('drains the renders behind it and reports the first failure', () => {
    render(React.createElement('Text', null, 'outer'));
    render(React.createElement(ThrowsOnCleanup));

    expect(() => cleanupActiveRenders()).toThrow('cleanup exploded');

    expect(() => screen.root).toThrow('No active component render');
  });
});
