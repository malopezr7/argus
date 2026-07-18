import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent } from '../src/events.js';
import { screen } from '../src/queries.js';
import { render } from '../src/render.js';

describe('component events', () => {
  it('finds an ancestor press handler and flushes state synchronously', () => {
    function Counter(): React.ReactElement {
      const [count, setCount] = React.useState(0);
      return React.createElement(
        'Pressable',
        { onPress: () => setCount((value) => value + 1) },
        React.createElement('Text', null, String(count)),
      );
    }

    const result = render(React.createElement(Counter));
    fireEvent.press(screen.getByText('0'));

    expect(screen.getByText('1').type).toBe('Text');
    result.unmount();
  });

  it('passes payloads through generic and changeText helpers', () => {
    const values: string[] = [];
    const result = render(
      React.createElement('TextInput', {
        onChangeText: (value: string) => values.push(value),
        onFocus: (value: string) => values.push(`focus:${value}`),
        placeholder: 'Name',
      }),
    );
    const input = screen.getByPlaceholderText('Name');

    fireEvent.changeText(input, 'Ada');
    fireEvent(input, 'focus', 'ready');

    expect(values).toEqual(['Ada', 'focus:ready']);
    result.unmount();
  });

  it('does not invoke disabled press or text-input handlers', () => {
    let calls = 0;
    const result = render(
      React.createElement(
        'View',
        null,
        React.createElement(
          'Pressable',
          { disabled: true, onPress: () => calls++ },
          React.createElement('Text', null, 'Disabled'),
        ),
        React.createElement('TextInput', {
          editable: false,
          onChangeText: () => calls++,
          placeholder: 'Locked',
        }),
      ),
    );

    fireEvent.press(screen.getByText('Disabled'));
    fireEvent.changeText(screen.getByPlaceholderText('Locked'), 'ignored');

    expect(calls).toBe(0);
    result.unmount();
  });
});
