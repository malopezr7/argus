import { render, screen, userEvent } from 'argus';
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

describe('userEvent on standalone Hermes', () => {
  test('observes the full press lifecycle with committed state between steps', async () => {
    const events: string[] = [];

    function PressLifecycle(): React.ReactElement {
      const [phase, setPhase] = React.useState('idle');
      return (
        <Pressable
          onPressIn={() => {
            events.push(`pressIn:${phase}`);
            setPhase('inside');
          }}
          onPressOut={() => {
            events.push(`pressOut:${phase}`);
            setPhase('outside');
          }}
          onPress={() => events.push(`press:${phase}`)}
        >
          <Text>{phase}</Text>
        </Pressable>
      );
    }

    render(<PressLifecycle />);
    await userEvent.setup().press(screen.getByText('idle'));

    expect(events.join(' > ')).toBe('pressIn:idle > pressOut:inside > press:outside');
    expect(screen.getByText('outside').type).toBe('Text');
  });

  test('observes focus, per-character input, submission, and blur in order', async () => {
    const events: string[] = [];

    function TypingLifecycle(): React.ReactElement {
      const [value, setValue] = React.useState('');
      return (
        <View>
          <TextInput
            placeholder="Editor"
            value={value}
            onPressIn={() => events.push('pressIn')}
            onFocus={() => events.push('focus')}
            onPressOut={() => events.push('pressOut')}
            onKeyPress={(event: { nativeEvent: { key: string } }) =>
              events.push(`key:${event.nativeEvent.key}`)
            }
            onChange={() => events.push('change')}
            onChangeText={(text) => {
              events.push(`text:${text}`);
              setValue(text);
            }}
            onSelectionChange={() => events.push('selection')}
            onSubmitEditing={() => events.push('submit')}
            onEndEditing={() => events.push('end')}
            onBlur={() => events.push('blur')}
          />
        </View>
      );
    }

    render(<TypingLifecycle />);
    await userEvent.type(screen.getByPlaceholderText('Editor'), 'ab', {
      submitEditing: true,
    });

    expect(events.join(' > ')).toBe(
      'pressIn > focus > pressOut > key:a > change > text:a > selection > ' +
        'key:b > change > text:ab > selection > submit > end > blur',
    );
    expect(screen.getByDisplayValue('ab').type).toBe('TextInput');
  });

  test('clears and pastes through their complete TextInput sequences', async () => {
    const events: string[] = [];

    function EditingLifecycle(): React.ReactElement {
      const [value, setValue] = React.useState('old');
      return (
        <TextInput
          placeholder="Value"
          value={value}
          onFocus={() => events.push('focus')}
          onSelectionChange={() => events.push('selection')}
          onKeyPress={() => events.push('key')}
          onChange={() => events.push('change')}
          onChangeText={(text) => {
            events.push(`text:${text}`);
            setValue(text);
          }}
          onEndEditing={() => events.push('end')}
          onBlur={() => events.push('blur')}
        />
      );
    }

    render(<EditingLifecycle />);
    const input = screen.getByPlaceholderText('Value');
    const user = userEvent.setup();
    await user.clear(input);
    await user.paste(input, 'new');

    expect(events.join(' > ')).toBe(
      'focus > selection > key > change > text: > selection > end > blur > ' +
        'focus > selection > change > text:new > selection > end > blur',
    );
    expect(screen.getByDisplayValue('new').type).toBe('TextInput');
  });
});
