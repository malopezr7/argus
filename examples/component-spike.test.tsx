import { act, type HostNode, render } from 'argus';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

const { useState } = React;

function textOf(node: HostNode): string {
  const text = node.children[0];
  if (typeof text !== 'string') throw new Error('Expected a text child');
  return text;
}

function firstHost(node: HostNode): HostNode {
  const child = node.children[0];
  if (typeof child === 'string') throw new Error('Expected a host child');
  return child;
}

describe('component renderer spike', () => {
  test('renders JSX and flushes useState through press inside act', () => {
    function Counter(): React.ReactNode {
      const [count, setCount] = useState(0);
      return (
        <Pressable onPress={() => setCount((value) => value + 1)}>
          <Text>{String(count)}</Text>
        </Pressable>
      );
    }

    const rendered = render(<Counter />);
    const pressable = firstHost(rendered.root);
    const label = firstHost(pressable);
    expect(textOf(label)).toBe('0');

    act(() => (pressable.props.onPress as () => void)());

    expect(textOf(firstHost(firstHost(rendered.root)))).toBe('1');
    rendered.unmount();
  });

  test('unmount runs component cleanup and empties the root', () => {
    let cleanupCount = 0;

    function CleanupProbe(): React.ReactNode {
      function attach(): () => void {
        return function cleanup(): void {
          cleanupCount++;
        };
      }

      return <View ref={attach} testID="cleanup-probe" />;
    }

    const rendered = render(<CleanupProbe />);
    expect(firstHost(rendered.root).props.testID).toBe('cleanup-probe');

    rendered.unmount();

    expect(cleanupCount).toBe(1);
    expect(rendered.root.children.length).toBe(0);
  });

  test('Promise-backed queueMicrotask can drive an acted state update', () => {
    return new Promise<void>((resolve, reject) => {
      let update: ((value: string) => void) | undefined;

      function MicrotaskProbe(): React.ReactNode {
        const [value, setValue] = useState('pending');
        update = setValue;
        return <Text>{value}</Text>;
      }

      const rendered = render(<MicrotaskProbe />);
      expect(textOf(firstHost(rendered.root))).toBe('pending');

      queueMicrotask(() => {
        try {
          act(() => update?.('complete'));
          expect(textOf(firstHost(rendered.root))).toBe('complete');
          rendered.unmount();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  test('does not emit act-environment console errors', () => {
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]): void => {
      errors.push(args.map(String).join(' '));
    };

    try {
      const rendered = render(<Text>quiet</Text>);
      expect(textOf(firstHost(rendered.root))).toBe('quiet');
      rendered.unmount();
    } finally {
      console.error = originalError;
    }

    expect(errors.filter((message) => message.includes('act environment')).length).toBe(0);
  });
});
