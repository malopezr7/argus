import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  describe as argusDescribe,
  flattenTests,
  runWith,
  test,
} from '../../framework/__tests__/run-harness.js';
import { act, fireEvent, render, screen, within } from '../src/index.js';

describe('component facade entry', () => {
  it('exposes the synchronous facade through one entry', () => {
    const result = render(
      React.createElement(
        'Pressable',
        { onPress: () => undefined },
        React.createElement('Text', null, 'entry'),
      ),
    );
    const label = screen.getByText('entry');

    expect(typeof act).toBe('function');
    expect(typeof fireEvent.press).toBe('function');
    expect(within(label.parent ?? label).getByText('entry')).toBe(label);
    result.unmount();
  });

  it('registers automatic cleanup between executed tests', async () => {
    const result = await runWith(() => {
      argusDescribe('cleanup', () => {
        test('renders', () => {
          render(React.createElement('Text', null, 'temporary'));
          expect(screen.getByText('temporary').type).toBe('Text');
        });
        test('is isolated', () => {
          expect(() => screen.root).toThrow('No active component render');
        });
      });
    });

    expect(flattenTests(result.suites).map((item) => item.status)).toEqual(['passed', 'passed']);
  });

  it('cleans active component roots after a failed test', async () => {
    const result = await runWith(() => {
      argusDescribe('component failure', () => {
        test('case', () => {
          render(React.createElement('Text', null, 'leaked'));
          throw new Error('failed after render');
        });
      });
    });

    expect(flattenTests(result.suites)[0].status).toBe('failed');
    expect(() => screen.root).toThrow('No active component render');
  });
});
