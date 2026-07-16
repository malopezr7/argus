import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '../../src/component/queries.js';
import { render } from '../../src/component/render.js';

describe('component queries', () => {
  it('supports every predicate and collection variant', () => {
    const result = render(
      React.createElement(
        'View',
        null,
        React.createElement('Text', { accessibilityRole: 'header', testID: 'title' }, 'Title'),
        React.createElement('TextInput', { placeholder: 'Email', value: 'user@example.com' }),
      ),
    );

    expect(screen.getByText('Title').props.testID).toBe('title');
    expect(screen.getByTestId('title').type).toBe('Text');
    expect(screen.getByRole('header').children).toEqual(['Title']);
    expect(screen.getByPlaceholderText('Email').type).toBe('TextInput');
    expect(screen.getByDisplayValue('user@example.com').props.placeholder).toBe('Email');
    expect(screen.getAllByText('Title')).toHaveLength(1);
    expect(screen.queryAllByTestId('title')).toHaveLength(1);
    result.unmount();
  });

  it('enforces zero and multiple cardinality semantics', () => {
    const result = render(
      React.createElement(
        'View',
        null,
        React.createElement('Text', null, 'duplicate'),
        React.createElement('Text', null, 'duplicate'),
      ),
    );

    expect(screen.queryByText('missing')).toBeNull();
    expect(screen.queryAllByText('missing')).toEqual([]);
    expect(() => screen.getByText('missing')).toThrow('No elements found');
    expect(() => screen.getAllByText('missing')).toThrow('No elements found');
    expect(() => screen.getByText('duplicate')).toThrow('Multiple elements found');
    expect(() => screen.queryByText('duplicate')).toThrow('Multiple elements found');
    expect(screen.getAllByText('duplicate')).toHaveLength(2);
    result.unmount();
  });

  it('scopes every query to the selected subtree', () => {
    const result = render(
      React.createElement(
        'View',
        null,
        React.createElement('View', { testID: 'left' }, React.createElement('Text', null, 'same')),
        React.createElement('View', { testID: 'right' }, React.createElement('Text', null, 'same')),
      ),
    );

    const left = screen.getByTestId('left');
    expect(within(left).getByText('same').parent).toBe(left);
    expect(within(left).queryAllByText('same')).toHaveLength(1);
    expect(screen.getAllByText('same')).toHaveLength(2);
    result.unmount();
  });
});
