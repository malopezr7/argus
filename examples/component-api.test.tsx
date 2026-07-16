import { act, fireEvent, render, screen, within } from 'argus';
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

describe('component facade', () => {
  test('renders, rerenders, and supports all query predicates', () => {
    const result = render(
      <View>
        <Text accessibilityRole="header" testID="title">
          old
        </Text>
        <TextInput placeholder="Email" value="user@example.com" />
      </View>,
    );

    expect(screen.getByText('old').props.testID).toBe('title');
    expect(screen.getByTestId('title').type).toBe('Text');
    expect(screen.getByRole('header').type).toBe('Text');
    expect(screen.getByPlaceholderText('Email').type).toBe('TextInput');
    expect(screen.getByDisplayValue('user@example.com').type).toBe('TextInput');

    result.rerender(<Text>new</Text>);
    expect(screen.getByText('new').type).toBe('Text');
    expect(screen.queryByText('old')).toBeNull();
    result.unmount();
  });

  test('scopes queries with within', () => {
    const result = render(
      <View>
        <View testID="left">
          <Text>same</Text>
        </View>
        <View testID="right">
          <Text>same</Text>
        </View>
      </View>,
    );

    const left = screen.getByTestId('left');
    expect(within(left).getAllByText('same').length).toBe(1);
    expect(screen.getAllByText('same').length).toBe(2);
    result.unmount();
  });

  test('dispatches events and flushes acted state changes', () => {
    let setCount: ((value: number) => void) | undefined;
    const values: string[] = [];

    function Form(): React.ReactElement {
      const [count, updateCount] = React.useState(0);
      setCount = updateCount;
      return (
        <View>
          <Pressable onPress={() => updateCount((value) => value + 1)}>
            <Text>{String(count)}</Text>
          </Pressable>
          <TextInput placeholder="Name" onChangeText={(value) => values.push(value)} />
          <Pressable disabled onPress={() => values.push('disabled')}>
            <Text>disabled</Text>
          </Pressable>
        </View>
      );
    }

    const result = render(<Form />);
    fireEvent.press(screen.getByText('0'));
    expect(screen.getByText('1').type).toBe('Text');

    fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Ada');
    fireEvent.press(screen.getByText('disabled'));
    expect(values).toEqual(['Ada']);

    act(() => setCount?.(7));
    result.rerender(<Form />);
    expect(screen.getByText('7').type).toBe('Text');
    result.unmount();
  });

  test('leaves cleanup to the internal lifecycle', () => {
    render(<Text>temporary</Text>);
    expect(screen.getByText('temporary').type).toBe('Text');
  });

  test('starts the next test without the previous root', () => {
    expect(() => screen.root).toThrow('No active component render');
  });
});
