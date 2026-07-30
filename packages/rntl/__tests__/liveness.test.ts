import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent } from '../src/events.js';
import { screen, within } from '../src/queries.js';
import { render } from '../src/render.js';

/**
 * A counter whose handler closes over the rendered `count` rather than using the
 * updater form. The updater form would read the latest state from React and so
 * would survive a stale closure; this form only works if the handler invoked is
 * the one from the most recent render.
 */
function Counter(): React.ReactElement {
  const [count, setCount] = React.useState(0);
  return React.createElement(
    'Pressable',
    { onPress: () => setCount(count + 1), testID: 'button' },
    React.createElement('Text', null, String(count)),
  );
}

describe('query results stay live across re-renders', () => {
  it('fires the newest handler when the same held node is pressed twice', () => {
    const result = render(React.createElement(Counter));
    const button = screen.getByTestId('button');

    fireEvent.press(button);
    fireEvent.press(button);

    expect(screen.getByText('2').type).toBe('Text');
    result.unmount();
  });

  it('reads updated props through a node held from before the re-render', () => {
    const result = render(React.createElement('Text', { testID: 'label' }, 'old'));
    const label = screen.getByTestId('label');

    result.rerender(React.createElement('Text', { testID: 'label' }, 'new'));

    expect(label.children).toEqual(['new']);
    result.unmount();
  });

  it('keeps a within(scope) handle usable after the scope re-renders', () => {
    const result = render(
      React.createElement('View', { testID: 'panel' }, React.createElement('Text', null, 'first')),
    );
    const panel = within(screen.getByTestId('panel'));

    result.rerender(
      React.createElement('View', { testID: 'panel' }, React.createElement('Text', null, 'second')),
    );

    expect(panel.getByText('second').type).toBe('Text');
    result.unmount();
  });

  it('detaches a node whose element an update removed', () => {
    const result = render(
      React.createElement('View', null, React.createElement('Text', { testID: 'gone' }, 'here')),
    );
    const held = screen.getByTestId('gone');

    result.rerender(React.createElement('View', null));

    // Reads keep working and report the last committed render, as a detached DOM
    // node keeps its attributes. The severed parent link is what marks it gone.
    expect(held.props.testID).toBe('gone');
    expect(held.children).toEqual(['here']);
    expect(held.parent).toBeNull();
    expect(screen.queryByTestId('gone')).toBeNull();
    result.unmount();
  });
});
