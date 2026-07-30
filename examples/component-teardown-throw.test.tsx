import { render, screen } from 'argus';
import React from 'react';
import { Text } from 'react-native';

const { useEffect } = React;

/**
 * A component whose unmount cleanup throws.
 *
 * The unmount is expected to fail — what must not happen is the render being
 * stranded in the active-render list by that failure. A stranded record is
 * flagged unmounted but never removed, so the internal afterEach cleanup spins
 * on a list that never shrinks. That spin is synchronous, so the file is killed
 * at the per-file timeout and reported as an infrastructure failure, which
 * discards every result in it — including the tests that already passed.
 */
function ThrowsOnCleanup(): React.ReactNode {
  useEffect(() => {
    return () => {
      throw new Error('cleanup exploded');
    };
  }, []);
  return <Text testID="probe">x</Text>;
}

describe('a render whose teardown throws', () => {
  test('fails the unmount without stranding the render', () => {
    const result = render(<ThrowsOnCleanup />);
    expect(screen.getByTestId('probe').type).toBe('Text');

    expect(() => result.unmount()).toThrow('cleanup exploded');
  });

  test('still runs the next test after that failed teardown', () => {
    const result = render(<Text testID="after">ok</Text>);

    expect(screen.getByTestId('after').type).toBe('Text');

    result.unmount();
  });
});
