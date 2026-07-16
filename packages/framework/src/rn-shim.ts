import type { ComponentType, ReactNode } from 'react';

export { NativeModules, TurboModuleRegistry, UIManager } from './native-mocks.js';

export interface ViewProps {
  children?: ReactNode;
  testID?: string;
  accessibilityRole?: string;
  [key: string]: unknown;
}

export interface TextProps extends ViewProps {}

export interface PressableProps extends ViewProps {
  disabled?: boolean;
  onPress?: () => void;
}

export interface TextInputProps extends ViewProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  editable?: boolean;
  onChangeText?: (value: string) => void;
}

export const View = 'View' as unknown as ComponentType<ViewProps>;
export const Text = 'Text' as unknown as ComponentType<TextProps>;
export const Pressable = 'Pressable' as unknown as ComponentType<PressableProps>;
export const TextInput = 'TextInput' as unknown as ComponentType<TextInputProps>;
