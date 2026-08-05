import { capturedSetTimeout } from '../../framework/src/fake-timers.js';
import { type AsyncWorkControl, runAsyncAct, runRegisteredAsyncWork } from './async.js';
import { isPointerEventEnabled } from './pointer-events.js';
import type { HostNode } from './tree.js';
import { textEvent, touchEvent } from './user-event-events.js';

type EventHandler = (payload?: unknown) => unknown;

export interface UserEventSetupOptions {
  delay?: number;
  advanceTimers?: (delay: number) => Promise<unknown> | unknown;
}

export interface UserEventConfig {
  delay: number;
  advanceTimers(delay: number): Promise<unknown> | unknown;
}

export interface TypeOptions {
  skipPress?: boolean;
  submitEditing?: boolean;
  skipBlur?: boolean;
}

export interface PressOptions {
  duration?: number;
}

export interface UserEventInstance {
  readonly config: UserEventConfig;
  press(node: HostNode): Promise<void>;
  longPress(node: HostNode, options?: PressOptions): Promise<void>;
  type(node: HostNode, text: string, options?: TypeOptions): Promise<void>;
  clear(node: HostNode): Promise<void>;
  paste(node: HostNode, text: string): Promise<void>;
}

const inputValues = new WeakMap<HostNode, string>();

function noTimerAdvancement(): void {}

function isDisabled(node: HostNode): boolean {
  const state = node.props.accessibilityState as { disabled?: unknown } | null | undefined;
  return (
    node.props.disabled === true ||
    (state !== null && typeof state === 'object' && state.disabled === true) ||
    (node.type === 'TextInput' && node.props.editable === false)
  );
}

function wait(config: UserEventConfig, duration?: number): Promise<void> {
  const delay = duration ?? config.delay;
  const scheduleTimer =
    config.advanceTimers === noTimerAdvancement ? capturedSetTimeout : setTimeout;
  return Promise.all([
    new Promise<void>(function schedule(resolve): void {
      scheduleTimer(resolve, delay);
    }),
    Promise.resolve(config.advanceTimers(delay)),
  ]).then(function waited(): void {});
}

function dispatch(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
  name: string,
  payload: unknown,
  delay?: number,
): Promise<void> {
  if (control.cancelled) return Promise.resolve();
  return runAsyncAct(function eventStep(): void | Promise<void> {
    function invoke(): void {
      if (control.cancelled) return;
      if (node.type !== '' && node.parent === null) return;
      const handler = node.props[name];
      if (typeof handler === 'function') (handler as EventHandler)(payload);
    }

    if (control.cancelled) return;
    if (delay === undefined) {
      invoke();
      return;
    }
    return wait(config, delay).then(invoke);
  }, true);
}

function pause(
  config: UserEventConfig,
  control: AsyncWorkControl,
  duration?: number,
): Promise<void> {
  if (control.cancelled) return Promise.resolve();
  return runAsyncAct(function pauseStep(): Promise<void> {
    if (control.cancelled) return Promise.resolve();
    return wait(config, duration);
  }, true);
}

interface PressBehavior {
  type: 'press' | 'longPress';
  duration?: number;
}

const DEFAULT_MIN_PRESS_DURATION = 130;

function hasPressHandler(node: HostNode): boolean {
  return (
    typeof node.props.onPressIn === 'function' ||
    typeof node.props.onPressOut === 'function' ||
    typeof node.props.onPress === 'function' ||
    typeof node.props.onLongPress === 'function'
  );
}

function responderEvent(registrationName: string): Record<string, unknown> {
  const event = touchEvent();
  event.dispatchConfig = { registrationName };
  return event;
}

async function emitDirectPressEvents(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
  behavior: PressBehavior,
): Promise<void> {
  await dispatch(config, control, node, 'onPressIn', touchEvent(), config.delay);
  await dispatch(
    config,
    control,
    node,
    behavior.type === 'longPress' ? 'onLongPress' : 'onPressOut',
    touchEvent(),
    behavior.duration ?? config.delay,
  );
  if (behavior.type === 'longPress') {
    await dispatch(config, control, node, 'onPressOut', touchEvent());
  } else {
    await dispatch(config, control, node, 'onPress', touchEvent());
  }
}

async function emitResponderPressEvents(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
  behavior: PressBehavior,
): Promise<void> {
  await dispatch(
    config,
    control,
    node,
    'onResponderGrant',
    responderEvent('onResponderGrant'),
    config.delay,
  );
  const duration = behavior.duration ?? DEFAULT_MIN_PRESS_DURATION;
  await dispatch(
    config,
    control,
    node,
    'onResponderRelease',
    responderEvent('onResponderRelease'),
    duration,
  );
  if (DEFAULT_MIN_PRESS_DURATION - duration > 0) {
    await pause(config, control, DEFAULT_MIN_PRESS_DURATION - duration);
  }
}

async function basePress(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
  behavior: PressBehavior,
): Promise<void> {
  let current: HostNode | null = node;
  while (current !== null && !control.cancelled) {
    const pointerEnabled = isPointerEventEnabled(current);
    if (pointerEnabled && !isDisabled(current) && hasPressHandler(current)) {
      await emitDirectPressEvents(config, control, current, behavior);
      return;
    }

    const responder = current.props.onStartShouldSetResponder;
    if (pointerEnabled && typeof responder === 'function' && responder()) {
      await emitResponderPressEvents(config, control, current, behavior);
      return;
    }
    current = current.parent;
  }
}

function press(config: UserEventConfig, control: AsyncWorkControl, node: HostNode): Promise<void> {
  return basePress(config, control, node, { type: 'press' });
}

function longPress(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
  options: PressOptions = {},
): Promise<void> {
  return basePress(config, control, node, {
    type: 'longPress',
    duration: options.duration ?? 500,
  });
}

function parseKeys(text: string): string[] {
  const keys: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining[0] === '{' && remaining[1] === '{') {
      keys[keys.length] = '{';
      remaining = remaining.slice(2);
      continue;
    }
    if (remaining[0] === '{') {
      const end = remaining.indexOf('}');
      if (end < 0) throw new Error(`Invalid key sequence "${remaining}"`);
      const key = remaining.slice(1, end);
      if (key.length > 1 && key !== 'Enter' && key !== 'Backspace') {
        throw new Error(`Unknown key "${key}" in "${text}"`);
      }
      keys[keys.length] = key;
      remaining = remaining.slice(end + 1);
      continue;
    }
    keys[keys.length] = remaining[0] === '\n' ? 'Enter' : remaining[0];
    remaining = remaining.slice(1);
  }
  return keys;
}

/** Value visible through a TextInput after native-style user interactions. */
export function getDisplayValue(node: HostNode): unknown {
  return node.props.value ?? inputValues.get(node) ?? node.props.defaultValue;
}

function inputValue(node: HostNode): string {
  const value = getDisplayValue(node) ?? '';
  return typeof value === 'string' ? value : String(value);
}

function applyKey(value: string, key: string): string {
  if (key === 'Enter') return `${value}\n`;
  if (key === 'Backspace') return value.slice(0, -1);
  return value + key;
}

function selectionEvent(text: string): Record<string, unknown> {
  return textEvent({ selection: { start: text.length, end: text.length } });
}

async function commitText(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
  text: string,
): Promise<void> {
  if (control.cancelled) return;
  inputValues.set(node, text);
  const selection = { start: text.length, end: text.length };
  await dispatch(
    config,
    control,
    node,
    'onChange',
    textEvent({ text, target: 0, eventCount: 0, selection }),
  );
  await dispatch(config, control, node, 'onChangeText', text);
  await dispatch(config, control, node, 'onSelectionChange', selectionEvent(text));

  if (node.props.multiline === true) {
    const lines = text.split('\n');
    let width = 0;
    for (let i = 0; i < lines.length; i++) width = Math.max(width, lines[i].length * 5);
    await dispatch(
      config,
      control,
      node,
      'onContentSizeChange',
      textEvent({ contentSize: { width, height: lines.length * 16 }, target: 0 }),
    );
  }
}

async function typeKey(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
  key: string,
): Promise<void> {
  if (control.cancelled) return;
  const previous = inputValue(node);
  const proposed = applyKey(previous, key);
  const maxLength = node.props.maxLength;
  const accepted = typeof maxLength !== 'number' || proposed.length <= maxLength;

  await dispatch(config, control, node, 'onKeyPress', textEvent({ key }), config.delay);
  if (!accepted || control.cancelled) return;
  await commitText(config, control, node, proposed);
}

async function typeText(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
  text: string,
  options: TypeOptions = {},
): Promise<void> {
  if (node.type !== 'TextInput') {
    throw new Error(
      `type() works only with host "TextInput" instances. Passed instance has type "${node.type}".`,
    );
  }
  if (isDisabled(node) || !isPointerEventEnabled(node)) return;

  if (!options.skipPress) await dispatch(config, control, node, 'onPressIn', touchEvent());
  await dispatch(config, control, node, 'onFocus', textEvent({ target: 0 }));
  if (!options.skipPress) {
    await dispatch(config, control, node, 'onPressOut', touchEvent(), config.delay);
  }

  const keys = parseKeys(text);
  for (let i = 0; i < keys.length && !control.cancelled; i++) {
    await typeKey(config, control, node, keys[i]);
  }

  if (control.cancelled) return;
  const finalText = inputValue(node);
  await pause(config, control);
  if (options.submitEditing) {
    await dispatch(
      config,
      control,
      node,
      'onSubmitEditing',
      textEvent({ text: finalText, target: 0 }),
    );
  }
  if (!options.skipBlur) {
    await dispatch(
      config,
      control,
      node,
      'onEndEditing',
      textEvent({ text: finalText, target: 0 }),
    );
    await dispatch(config, control, node, 'onBlur', textEvent({ target: 0 }));
  }
}

function ensureTextInput(node: HostNode, method: 'clear' | 'paste'): void {
  if (node.type !== 'TextInput') {
    throw new Error(
      `${method}() only supports host "TextInput" instances. Passed instance has type: "${node.type}".`,
    );
  }
}

async function clear(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
): Promise<void> {
  ensureTextInput(node, 'clear');
  if (isDisabled(node) || !isPointerEventEnabled(node)) return;

  await dispatch(config, control, node, 'onFocus', textEvent({ target: 0 }));
  const current = inputValue(node);
  await dispatch(
    config,
    control,
    node,
    'onSelectionChange',
    textEvent({ selection: { start: 0, end: current.length } }),
  );
  await dispatch(
    config,
    control,
    node,
    'onKeyPress',
    textEvent({ key: 'Backspace' }),
    config.delay,
  );
  await commitText(config, control, node, '');
  await pause(config, control);
  await dispatch(config, control, node, 'onEndEditing', textEvent({ text: '', target: 0 }));
  await dispatch(config, control, node, 'onBlur', textEvent({ target: 0 }));
}

async function paste(
  config: UserEventConfig,
  control: AsyncWorkControl,
  node: HostNode,
  text: string,
): Promise<void> {
  ensureTextInput(node, 'paste');
  if (isDisabled(node) || !isPointerEventEnabled(node)) return;

  await dispatch(config, control, node, 'onFocus', textEvent({ target: 0 }));
  const current = inputValue(node);
  await dispatch(
    config,
    control,
    node,
    'onSelectionChange',
    textEvent({ selection: { start: 0, end: current.length } }),
  );
  await commitText(config, control, node, text);
  await pause(config, control);
  await dispatch(config, control, node, 'onEndEditing', textEvent({ text, target: 0 }));
  await dispatch(config, control, node, 'onBlur', textEvent({ target: 0 }));
}

function completeInteraction(
  config: UserEventConfig,
  interaction: (control: AsyncWorkControl) => Promise<void>,
): Promise<void> {
  return runRegisteredAsyncWork(function registeredInteraction(control): Promise<void> {
    return interaction(control).then(function finishInteraction(): Promise<void> {
      return pause(config, control);
    });
  });
}

export function setup(options: UserEventSetupOptions = {}): UserEventInstance {
  const config: UserEventConfig = {
    delay: options.delay ?? 0,
    advanceTimers: options.advanceTimers ?? noTimerAdvancement,
  };
  return {
    config,
    press: function userPress(node): Promise<void> {
      return completeInteraction(config, function runPress(control): Promise<void> {
        return press(config, control, node);
      });
    },
    longPress: function userLongPress(node, pressOptions): Promise<void> {
      return completeInteraction(config, function runLongPress(control): Promise<void> {
        return longPress(config, control, node, pressOptions);
      });
    },
    type: function userType(node, text, typeOptions): Promise<void> {
      return completeInteraction(config, function runType(control): Promise<void> {
        return typeText(config, control, node, text, typeOptions);
      });
    },
    clear: function userClear(node): Promise<void> {
      return completeInteraction(config, function runClear(control): Promise<void> {
        return clear(config, control, node);
      });
    },
    paste: function userPaste(node, text): Promise<void> {
      return completeInteraction(config, function runPaste(control): Promise<void> {
        return paste(config, control, node, text);
      });
    },
  };
}

export const userEvent = {
  setup,
  press: function directPress(node: HostNode): Promise<void> {
    return setup().press(node);
  },
  longPress: function directLongPress(node: HostNode, options?: PressOptions): Promise<void> {
    return setup().longPress(node, options);
  },
  type: function directType(node: HostNode, text: string, options?: TypeOptions): Promise<void> {
    return setup().type(node, text, options);
  },
  clear: function directClear(node: HostNode): Promise<void> {
    return setup().clear(node);
  },
  paste: function directPaste(node: HostNode, text: string): Promise<void> {
    return setup().paste(node, text);
  },
};
