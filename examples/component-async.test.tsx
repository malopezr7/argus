import { render, screen, waitFor, waitForElementToBeRemoved } from 'argus';
import React from 'react';
import { Text } from 'react-native';

function PromiseStatus(): React.ReactNode {
  const [status, setStatus] = React.useState('promise pending');
  React.useEffect(() => {
    Promise.resolve().then(() => setStatus('promise ready'));
  }, []);
  return <Text>{status}</Text>;
}

function TimerStatus(): React.ReactNode {
  const [status, setStatus] = React.useState('timer pending');
  React.useEffect(() => {
    setTimeout(() => {
      setTimeout(() => setStatus('timer ready'), 10);
    }, 10);
  }, []);
  return <Text>{status}</Text>;
}

function VanishingStatus(): React.ReactNode {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    Promise.resolve().then(() => setVisible(false));
  }, []);
  return visible ? <Text>loading</Text> : null;
}

describe('component async testing', () => {
  test('findByText observes an update from a resolved promise', async () => {
    const result = render(<PromiseStatus />);

    expect((await result.findByText('promise ready')).type).toBe('Text');
  });

  test('findByText observes an update from chained timers', async () => {
    render(<TimerStatus />);

    expect((await screen.findByText('timer ready')).type).toBe('Text');
  });

  test('waitForElementToBeRemoved observes a disappearing element', async () => {
    render(<VanishingStatus />);

    const loading = screen.getByText('loading');
    expect(await waitForElementToBeRemoved(loading)).toBe(loading);
    expect(screen.queryByText('loading')).toBe(null);
  });

  test('slow synchronous work exhausts the wall-clock budget', async () => {
    let message = '';
    try {
      await waitFor(
        () => {
          const startedAt = Date.now();
          let spins = 0;
          while (Date.now() - startedAt < 5) spins++;
          expect(spins).toBeGreaterThan(0);
          throw new Error('still waiting');
        },
        { timeout: 1, interval: 10 },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('still waiting');
    expect(message).toContain('wall-clock budget');
  });

  test('a legitimate async query timeout is an ordinary test failure', async () => {
    render(<Text>present</Text>);

    await screen.findByText('never appears', { timeout: 100, interval: 10 });
  });

  test('the file continues after the timed-out test', () => {
    render(<Text>after timeout</Text>);

    expect(screen.getByText('after timeout').type).toBe('Text');
  });
});
