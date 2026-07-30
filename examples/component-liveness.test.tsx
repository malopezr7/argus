import { fireEvent, render, screen, within } from 'argus';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

const { useState } = React;

/**
 * The handler closes over the rendered `count` instead of using the updater form.
 * The updater form reads the latest state from React and so survives a stale
 * closure; this form only reaches 2 if the second press invokes the handler from
 * the second render. Before host nodes read through to the fiber, a node held
 * across an update kept the props object it was queried at, and this went
 * 0 -> 1 -> 1 on the real engine while every unit test stayed green.
 */
function Counter(): React.ReactNode {
  const [count, setCount] = useState(0);
  return (
    <View testID="panel">
      <Pressable onPress={() => setCount(count + 1)} testID="button">
        <Text>{String(count)}</Text>
      </Pressable>
    </View>
  );
}

describe('component node liveness', () => {
  test('presses a held node twice and advances twice', () => {
    const result = render(<Counter />);
    const button = screen.getByTestId('button');

    fireEvent.press(button);
    fireEvent.press(button);

    expect(screen.getByText('2').type).toBe('Text');
    result.unmount();
  });

  test('reads updated children through a node held from before the update', () => {
    const result = render(<Text testID="label">old</Text>);
    const label = screen.getByTestId('label');

    result.rerender(<Text testID="label">new</Text>);

    expect(label.children).toEqual(['new']);
    result.unmount();
  });

  test('keeps a within scope usable after that scope re-renders', () => {
    const result = render(<Counter />);
    const panel = within(screen.getByTestId('panel'));

    fireEvent.press(panel.getByTestId('button'));

    expect(panel.getByText('1').type).toBe('Text');
    result.unmount();
  });

  test('detaches a node whose element an update removed', () => {
    const result = render(
      <View>
        <Text testID="gone">here</Text>
      </View>,
    );
    const held = screen.getByTestId('gone');

    result.rerender(<View />);

    expect(held.props.testID).toBe('gone');
    expect(held.children).toEqual(['here']);
    expect(held.parent).toBe(null);
    expect(screen.queryByTestId('gone')).toBe(null);
    result.unmount();
  });
});
