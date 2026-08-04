import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, userEvent } from '../src/index.js';

describe('userEvent React Native fidelity', () => {
  it('honors pointerEvents props, flattened styles, box-only ancestors, and box-none targets', async () => {
    const events: string[] = [];
    const result = render(
      React.createElement(
        'View',
        null,
        React.createElement(
          'Pressable',
          { pointerEvents: 'none', onPress: () => events.push('none') },
          React.createElement('Text', null, 'None'),
        ),
        React.createElement(
          'Pressable',
          {
            style: [{ opacity: 1 }, [{ pointerEvents: 'none' }]],
            onPress: () => events.push('style-none'),
          },
          React.createElement('Text', null, 'Style none'),
        ),
        React.createElement(
          'View',
          { pointerEvents: 'box-only', onPress: () => events.push('box-only-parent') },
          React.createElement(
            'Pressable',
            { onPress: () => events.push('box-only-child') },
            React.createElement('Text', null, 'Box only'),
          ),
        ),
        React.createElement(
          'View',
          { pointerEvents: 'box-none', onPress: () => events.push('box-none') },
          React.createElement('Text', null, 'Box none'),
        ),
      ),
    );

    try {
      await userEvent.press(screen.getByText('None'));
      await userEvent.press(screen.getByText('Style none'));
      await userEvent.press(screen.getByText('Box only'));
      await userEvent.press(screen.getByText('Box none'));

      expect(events).toEqual(['box-only-parent']);
    } finally {
      result.unmount();
    }
  });

  it('blocks type, clear, and paste when pointer events are disabled', async () => {
    const events: string[] = [];
    const result = render(
      React.createElement(
        'View',
        null,
        React.createElement('TextInput', {
          pointerEvents: 'none',
          placeholder: 'Type blocked',
          onChangeText: () => events.push('type'),
        }),
        React.createElement('TextInput', {
          defaultValue: 'old',
          pointerEvents: 'none',
          placeholder: 'Clear blocked',
          onChangeText: () => events.push('clear'),
        }),
        React.createElement('TextInput', {
          pointerEvents: 'none',
          placeholder: 'Paste blocked',
          onChangeText: () => events.push('paste'),
        }),
      ),
    );

    try {
      const user = userEvent.setup();
      await user.type(screen.getByPlaceholderText('Type blocked'), 'x');
      await user.clear(screen.getByPlaceholderText('Clear blocked'));
      await user.paste(screen.getByPlaceholderText('Paste blocked'), 'x');

      expect(events).toEqual([]);
    } finally {
      result.unmount();
    }
  });

  it('uses the touch responder path and its Pressability duration', async () => {
    const events: string[] = [];
    const advanced: number[] = [];
    const result = render(
      React.createElement(
        'View',
        {
          onStartShouldSetResponder: () => true,
          onResponderGrant: (event: { dispatchConfig?: { registrationName?: string } }) =>
            events.push(event.dispatchConfig?.registrationName ?? 'missing grant config'),
          onResponderRelease: (event: { dispatchConfig?: { registrationName?: string } }) =>
            events.push(event.dispatchConfig?.registrationName ?? 'missing release config'),
        },
        React.createElement('Text', null, 'Responder'),
      ),
    );

    try {
      await userEvent
        .setup({ advanceTimers: (delay) => advanced.push(delay) })
        .press(screen.getByText('Responder'));

      expect(events).toEqual(['onResponderGrant', 'onResponderRelease']);
      expect(advanced).toEqual([0, 130, 0]);
    } finally {
      result.unmount();
    }
  });

  it('walks past a disabled press target to an enabled ancestor', async () => {
    const events: string[] = [];
    const result = render(
      React.createElement(
        'Pressable',
        { onPress: () => events.push('outer') },
        React.createElement(
          'Pressable',
          { disabled: true, onPress: () => events.push('inner') },
          React.createElement('Text', null, 'Nested'),
        ),
      ),
    );

    try {
      await userEvent.press(screen.getByText('Nested'));
      expect(events).toEqual(['outer']);
    } finally {
      result.unmount();
    }
  });

  it('types a one-character braced token literally', async () => {
    const values: string[] = [];
    const result = render(
      React.createElement('TextInput', {
        placeholder: 'Braced',
        onChangeText: (text: string) => values.push(text),
      }),
    );

    try {
      await userEvent.type(screen.getByPlaceholderText('Braced'), '{a}', {
        skipPress: true,
        skipBlur: true,
      });

      expect(values).toEqual(['a']);
      expect(screen.getByDisplayValue('a').type).toBe('TextInput');
    } finally {
      result.unmount();
    }
  });
});
