---
title: Native modules
description: Registering fake native modules so code that reaches for NativeModules or TurboModuleRegistry runs on Hermes.
sidebar:
  order: 5
---

Standalone Hermes has no React Native runtime. There is no bridge, no TurboModule
infrastructure, and nothing behind `NativeModules`.

Argus aliases the `react-native` specifier to an in-realm shim at bundle time, so code that
imports from it resolves to something real — and you decide what each native module
returns.

## Registering a module

```ts
import { NativeModules, TurboModuleRegistry } from 'react-native';

describe('BiometricsGate', () => {
  beforeEach(() => {
    argus.resetNativeModules();
    argus.mockNativeModule('Biometrics', () => ({
      isAvailable: argus.fn().mockReturnValue(true),
      authenticate: argus.fn().mockResolvedValue({ ok: true }),
    }));
  });

  test('authenticates when hardware is available', async () => {
    const gate = new BiometricsGate();

    await expect(gate.unlock()).resolves.toBe(true);

    const native = TurboModuleRegistry.getEnforcing('Biometrics');
    expect(native.authenticate).toHaveBeenCalled();
  });
});
```

`mockNativeModule(name, factory)` calls the factory immediately and stores the result. The
same object is then returned by all three access paths:

| Access | Returns |
|---|---|
| `NativeModules.Biometrics` | The registered object |
| `TurboModuleRegistry.get('Biometrics')` | The registered object, or `null` if unregistered |
| `TurboModuleRegistry.getEnforcing('Biometrics')` | The registered object, or throws if unregistered |

`getEnforcing` on an unregistered name throws
`TurboModuleRegistry.getEnforcing('X'): module not registered` — which is the same failure
shape production code sees when a native module is genuinely missing, so error paths are
testable.

## Reset between tests

The registry is global to the file's realm. `argus.resetNativeModules()` empties it.

```ts
beforeEach(() => {
  argus.resetNativeModules();
});
```

Do it in `beforeEach` rather than `afterEach`: a test that fails midway then still starts
the next one from a clean registry.

## The component shim

The same `react-native` alias exports a minimal set of host components, which is what
[component testing](/tests/components/) renders against:

```ts
import { Pressable, Text, TextInput, View } from 'react-native';
```

| Component | Props the queries and events understand |
|---|---|
| `View` | `testID`, `accessibilityRole`, `children`, anything else |
| `Text` | as `View`; its text content is what `getByText` matches |
| `Pressable` | `onPress`, `disabled` |
| `TextInput` | `value`, `defaultValue`, `placeholder`, `editable`, `onChangeText` |

`UIManager` is exported as an empty object so imports of it resolve without a crash.

These are host-component *names*, not implementations. Nothing lays out, measures, or
paints — see [Limitations](/reference/limitations/).

## What this is not

This shim covers native-module **infrastructure**, not the React Native JavaScript library.
`AppState`, `Dimensions`, `Animated`, `Linking`, `AsyncStorage` and friends are not
implemented.

When your code depends on one of those, the productive move is the same as with timers:
take it as a dependency instead of importing it deep in the call stack, and pass a fake in
tests. Code written that way is testable on every runner, not just this one.
