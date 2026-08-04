import { render, screen, userEvent } from 'argus';
import { Pressable, Text, TextInput, View } from 'react-native';

describe('userEvent regression coverage on standalone Hermes', () => {
  let phase = 'outside';
  let pending: Promise<void> = Promise.resolve();
  const advanced: string[] = [];
  const leaked: string[] = [];

  test('starts an interaction that the test abandons', () => {
    phase = 'first';
    render(
      <Pressable
        onPressIn={() => leaked.push(`pressIn:${phase}`)}
        onPressOut={() => {
          leaked.push(`pressOut:${phase}`);
          if (phase !== 'first') expect('leaked').toBe('failure');
        }}
        onPress={() => leaked.push(`press:${phase}`)}
      >
        <Text>Abandon</Text>
      </Pressable>,
    );

    pending = userEvent
      .setup({
        advanceTimers: (delay) => {
          advanced.push(`${delay}:${phase}`);
        },
      })
      .press(screen.getByText('Abandon'));
  });

  test('begins with no callbacks or act scope left by the previous test', async () => {
    phase = 'second';
    render(<Text>Clean next test</Text>);
    await pending;

    expect(screen.getByText('Clean next test').type).toBe('Text');
    expect(advanced.filter((entry) => entry.endsWith(':second'))).toEqual([]);
    expect(leaked).toEqual([]);
  });

  test('uses configured delay for direct press events', async () => {
    const delays: number[] = [];
    render(
      <Pressable onPress={() => {}}>
        <Text>Direct</Text>
      </Pressable>,
    );

    const user = userEvent.setup({
      advanceTimers: (delay) => {
        delays.push(delay);
      },
    });
    await user.press(screen.getByText('Direct'));
    expect(delays).toEqual([0, 0, 0]);
  });

  test('blocks a press when pointer events are disabled', async () => {
    const events: string[] = [];
    render(
      <Pressable pointerEvents="none" onPress={() => events.push('blocked')}>
        <Text>Blocked</Text>
      </Pressable>,
    );

    await userEvent.press(screen.getByText('Blocked'));
    expect(events).toEqual([]);
  });

  test('emits responder grant and release', async () => {
    const events: string[] = [];
    render(
      <View
        onStartShouldSetResponder={() => true}
        onResponderGrant={() => events.push('grant')}
        onResponderRelease={() => events.push('release')}
      >
        <Text>Responder</Text>
      </View>,
    );

    await userEvent.press(screen.getByText('Responder'));
    expect(events).toEqual(['grant', 'release']);
  });

  test('walks past a disabled pressable to its enabled parent', async () => {
    const events: string[] = [];
    render(
      <Pressable onPress={() => events.push('outer')}>
        <Pressable disabled onPress={() => events.push('inner')}>
          <Text>Nested</Text>
        </Pressable>
      </Pressable>,
    );

    await userEvent.press(screen.getByText('Nested'));
    expect(events).toEqual(['outer']);
  });

  test('types a one-character braced token literally', async () => {
    const events: string[] = [];
    render(<TextInput placeholder="Braced" onChangeText={(text) => events.push(`text:${text}`)} />);

    await userEvent.type(screen.getByPlaceholderText('Braced'), '{a}', {
      skipPress: true,
      skipBlur: true,
    });
    expect(events).toEqual(['text:a']);
  });
});
