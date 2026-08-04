import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, userEvent, waitFor } from '../src/index.js';

describe('userEvent', () => {
  it('presses through the React Native press lifecycle and flushes each step', async () => {
    const events: string[] = [];
    const advanced: number[] = [];

    function PressLifecycle(): React.ReactElement {
      const [phase, setPhase] = React.useState('idle');
      return React.createElement(
        'Pressable',
        {
          onPressIn: () => {
            events.push(`pressIn:${phase}`);
            setPhase('inside');
          },
          onPressOut: () => {
            events.push(`pressOut:${phase}`);
            setPhase('outside');
          },
          onPress: () => events.push(`press:${phase}`),
        },
        React.createElement('Text', null, phase),
      );
    }

    const result = render(React.createElement(PressLifecycle));
    try {
      await userEvent
        .setup({ advanceTimers: (delay) => advanced.push(delay) })
        .press(screen.getByText('idle'));

      expect(events).toEqual(['pressIn:idle', 'pressOut:inside', 'press:outside']);
      expect(advanced).toEqual([0, 0, 0]);
      expect(screen.getByText('outside').type).toBe('Text');
    } finally {
      result.unmount();
    }
  });

  it('finds an ancestor press target, respects disabled state, and shares the wait scheduler', async () => {
    const diagnostics: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      diagnostics.push(args.join(' '));
    };

    function PressTargets(): React.ReactElement {
      const [status, setStatus] = React.useState('ready');
      return React.createElement(
        'View',
        null,
        React.createElement(
          'Pressable',
          { onPress: () => setStatus('pressed') },
          React.createElement('Text', null, status),
        ),
        React.createElement(
          'Pressable',
          {
            accessibilityState: { disabled: true },
            onPress: () => setStatus('disabled press ran'),
          },
          React.createElement('Text', null, 'disabled'),
        ),
      );
    }

    const result = render(React.createElement(PressTargets));
    try {
      const press = userEvent.press(screen.getByText('ready'));
      const pressed = waitFor(() => screen.getByText('pressed'));
      await Promise.all([press, pressed]);
      await userEvent.press(screen.getByText('disabled'));

      expect(screen.queryByText('disabled press ran')).toBeNull();
      expect(diagnostics.join('\n')).not.toContain('overlapping act() calls');
    } finally {
      console.error = originalError;
      result.unmount();
    }
  });

  it('settles work queued by the final handler before the interaction resolves', async () => {
    function DeferredPress(): React.ReactElement {
      const [status, setStatus] = React.useState('idle');
      return React.createElement(
        'Pressable',
        { onPress: () => setTimeout(() => setStatus('settled'), 0) },
        React.createElement('Text', null, status),
      );
    }

    const result = render(React.createElement(DeferredPress));
    try {
      await userEvent.press(screen.getByText('idle'));
      expect(screen.getByText('settled').type).toBe('Text');
    } finally {
      result.unmount();
    }
  });

  it('types through focus and per-key events before submitting and blurring', async () => {
    const events: string[] = [];
    const values: string[] = [];
    const keys: string[] = [];

    function ControlledInput(): React.ReactElement {
      const [value, setValue] = React.useState('');
      const log = (name: string) => (): void => {
        events.push(name);
      };
      return React.createElement('TextInput', {
        placeholder: 'Name',
        value,
        onPressIn: log('pressIn'),
        onFocus: log('focus'),
        onPressOut: log('pressOut'),
        onKeyPress: (event: { nativeEvent: { key: string } }) => {
          events.push('keyPress');
          keys.push(event.nativeEvent.key);
        },
        onChange: log('change'),
        onChangeText: (text: string) => {
          events.push('changeText');
          values.push(text);
          setValue(text);
        },
        onSelectionChange: log('selectionChange'),
        onSubmitEditing: log('submitEditing'),
        onEndEditing: log('endEditing'),
        onBlur: log('blur'),
      });
    }

    const result = render(React.createElement(ControlledInput));
    try {
      await userEvent.setup().type(screen.getByPlaceholderText('Name'), 'ab', {
        submitEditing: true,
      });

      expect(events).toEqual([
        'pressIn',
        'focus',
        'pressOut',
        'keyPress',
        'change',
        'changeText',
        'selectionChange',
        'keyPress',
        'change',
        'changeText',
        'selectionChange',
        'submitEditing',
        'endEditing',
        'blur',
      ]);
      expect(keys).toEqual(['a', 'b']);
      expect(values).toEqual(['a', 'ab']);
      expect(screen.getByDisplayValue('ab').type).toBe('TextInput');
    } finally {
      result.unmount();
    }
  });

  it('supports special keys and options while ignoring locked text inputs', async () => {
    const events: string[] = [];
    const values: string[] = [];
    const result = render(
      React.createElement(
        'View',
        null,
        React.createElement('TextInput', {
          defaultValue: 'xy',
          maxLength: 3,
          placeholder: 'Editable',
          onFocus: () => events.push('focus'),
          onKeyPress: (event: { nativeEvent: { key: string } }) =>
            events.push(`key:${event.nativeEvent.key}`),
          onChangeText: (text: string) => values.push(text),
          onEndEditing: () => events.push('endEditing'),
          onBlur: () => events.push('blur'),
        }),
        React.createElement('TextInput', {
          editable: false,
          placeholder: 'Locked',
          onChangeText: () => events.push('locked change'),
        }),
      ),
    );

    try {
      const user = userEvent.setup();
      await user.type(screen.getByPlaceholderText('Editable'), '{Backspace}a{Enter}z', {
        skipPress: true,
        skipBlur: true,
      });
      await user.type(screen.getByPlaceholderText('Locked'), 'ignored');

      expect(events).toEqual(['focus', 'key:Backspace', 'key:a', 'key:Enter', 'key:z']);
      expect(values).toEqual(['x', 'xa', 'xa\n']);
      expect(events).not.toContain('locked change');
    } finally {
      result.unmount();
    }
  });

  it('retains unmanaged TextInput state across interactions and display queries', async () => {
    const result = render(React.createElement('TextInput', { placeholder: 'Unmanaged' }));
    try {
      const input = screen.getByPlaceholderText('Unmanaged');
      const user = userEvent.setup();
      await user.type(input, 'Hello');
      await user.type(input, ' World');

      expect(screen.getByDisplayValue('Hello World')).toBe(input);
      await user.clear(input);
      expect(screen.getByDisplayValue('')).toBe(input);
    } finally {
      result.unmount();
    }
  });

  it('long-presses without a regular press and keeps the documented event order', async () => {
    const events: string[] = [];
    const result = render(
      React.createElement(
        'Pressable',
        {
          onPressIn: () => events.push('pressIn'),
          onLongPress: () => events.push('longPress'),
          onPressOut: () => events.push('pressOut'),
          onPress: () => events.push('press'),
        },
        React.createElement('Text', null, 'Hold'),
      ),
    );

    try {
      await userEvent.longPress(screen.getByText('Hold'), { duration: 1 });
      expect(events).toEqual(['pressIn', 'longPress', 'pressOut']);
    } finally {
      result.unmount();
    }
  });

  it('clears and pastes with native TextInput event sequences', async () => {
    const events: string[] = [];
    const values: string[] = [];

    function ControlledInput(): React.ReactElement {
      const [value, setValue] = React.useState('old');
      const log = (name: string) => (): void => {
        events.push(name);
      };
      return React.createElement('TextInput', {
        placeholder: 'Editor',
        value,
        onFocus: log('focus'),
        onSelectionChange: log('selectionChange'),
        onKeyPress: log('keyPress'),
        onChange: log('change'),
        onChangeText: (text: string) => {
          events.push('changeText');
          values.push(text);
          setValue(text);
        },
        onEndEditing: log('endEditing'),
        onBlur: log('blur'),
      });
    }

    const result = render(React.createElement(ControlledInput));
    try {
      const input = screen.getByPlaceholderText('Editor');
      const user = userEvent.setup();
      await user.clear(input);
      expect(events).toEqual([
        'focus',
        'selectionChange',
        'keyPress',
        'change',
        'changeText',
        'selectionChange',
        'endEditing',
        'blur',
      ]);
      expect(values).toEqual(['']);

      events.length = 0;
      await user.paste(input, 'new');
      expect(events).toEqual([
        'focus',
        'selectionChange',
        'change',
        'changeText',
        'selectionChange',
        'endEditing',
        'blur',
      ]);
      expect(values).toEqual(['', 'new']);
      expect(screen.getByDisplayValue('new').type).toBe('TextInput');
    } finally {
      result.unmount();
    }
  });
});
