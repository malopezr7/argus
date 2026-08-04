import { render, screen } from 'argus';
import { Text } from 'react-native';

describe('abandoned component waits', () => {
  test('starts a wait without awaiting it', () => {
    render(<Text>first test</Text>);

    void screen.findByText('never appears', { timeout: 100, interval: 10 });
    expect(screen.getByText('first test').type).toBe('Text');
  });

  test('the next test is isolated from the abandoned wait', () => {
    render(<Text>second test</Text>);

    expect(screen.getByText('second test').type).toBe('Text');
  });
});
