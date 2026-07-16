import { describe, expect, it } from 'vitest';
import { Pressable, Text, TextInput, View } from '../src/rn-shim.js';

describe('react-native primitive shim', () => {
  it('exports string host types for every supported primitive', () => {
    expect([View, Text, Pressable, TextInput]).toEqual(['View', 'Text', 'Pressable', 'TextInput']);
  });
});
