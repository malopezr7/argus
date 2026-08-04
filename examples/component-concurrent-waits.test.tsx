import { render, screen, waitFor } from 'argus';
import React from 'react';
import { Text, View } from 'react-native';

function ConcurrentStatus(): React.ReactNode {
  const [first, setFirst] = React.useState('first pending');
  const [second, setSecond] = React.useState('second pending');

  React.useEffect(() => {
    setTimeout(() => setFirst('first ready'), 10);
    setTimeout(() => setSecond('second ready'), 10);
  }, []);

  return (
    <View>
      <Text>{first}</Text>
      <Text>{second}</Text>
    </View>
  );
}

describe('concurrent component waits', () => {
  test('two concurrent findBy queries do not overlap act scopes', async () => {
    const diagnostics: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      diagnostics[diagnostics.length] = args.join(' ');
    };

    try {
      render(<ConcurrentStatus />);
      const [first, second] = await Promise.all([
        screen.findByText('first ready'),
        screen.findByText('second ready'),
      ]);

      expect(first.type).toBe('Text');
      expect(second.type).toBe('Text');
      expect(diagnostics.join('\n')).not.toContain('overlapping act() calls');
    } finally {
      console.error = originalError;
    }
  });

  test('a wait can start inside another wait callback', async () => {
    let innerAttempts = 0;
    const diagnostics: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      diagnostics[diagnostics.length] = args.join(' ');
    };

    try {
      const value = await waitFor(
        async () =>
          waitFor(
            () => {
              innerAttempts++;
              if (innerAttempts === 1) throw new Error('inner pending');
              return 'nested ready';
            },
            { timeout: 100, interval: 5 },
          ),
        { timeout: 100, interval: 5 },
      );

      expect(value).toBe('nested ready');
      expect(diagnostics.join('\n')).not.toContain('overlapping act() calls');
    } finally {
      console.error = originalError;
    }
  });
});
