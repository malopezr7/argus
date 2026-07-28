---
title: Why Hermes, not Node
description: The concrete places where a Node-based test run tells you something that is not true on the engine your app ships.
sidebar:
  order: 2
---

Most React Native test suites run on **Node/V8** through Jest or Vitest. That is fast,
familiar, and correct for most of what you test. It is also the wrong engine.

React Native ships on **Hermes**. A green Node suite is evidence about V8, and V8 is not
what runs in your users' hands.

## Where the two disagree

Engine differences are not exotic trivia. They show up in ordinary code:

- **Language support.** The legacy Hermes engine parses no `class` syntax at all — no
  classes, no private fields, no static blocks, no `async` arrow functions, no `WeakRef`.
  Node parses all of it. A dependency that ships modern syntax builds fine in your Node
  test run and fails to parse on device.
- **Stack shapes.** Error stacks are formatted differently. Code that parses `error.stack`
  — crash reporters, error boundaries, log scrubbers — behaves differently.
- **Microtask ordering.** Promise scheduling around the two engines' job queues is not
  identical in every edge case.
- **`Intl`.** On Hermes this is a *build flag*, not a language guarantee. A VM built
  without it silently lacks `Intl` while your production engine has it — or the reverse.
  Date and number formatting quietly diverges.
- **Regex and number formatting.** Small but real differences in the edges.
- **Bundler lowering.** Your production bundle is transformed for the Hermes syntax
  envelope. That transformation itself can introduce bugs that only exist in the
  transformed output — code that is correct in source and wrong once lowered.

That last one is worth dwelling on, because it is the class of bug that motivated this
project.

## The bug that only exists after bundling

esbuild, targeting Hermes, lowers a loop-scoped `const` to `var`. A closure created inside
that loop then captures the **last** iteration's value rather than its own.

```ts
// Correct in source. Broken once lowered for Hermes.
for (const key of methods) {
  const original = target[key];
  target[key] = (...args) => count(original, args); // every wrapper calls the LAST method
}
```

This passed every Node unit test. It only failed on a real Hermes run, because the bug does
not exist until the bundle is lowered — and Node never sees the lowered bundle.

No amount of testing on V8 finds that. Running the actual artifact on the actual engine
does, immediately.

## What Argus does about it

Argus makes the *artifact* the unit under test: your code, bundled exactly the way it will
be bundled, executed by the exact VM your project pins.

- The engine is read from **your** React Native install, not guessed —
  see [How the binary is provisioned](/hermes/provisioning/).
- A binary whose bytecode version does not match the engine your project targets produces
  a loud warning naming both engines, never a silent pass.
- Hermes is built with the same flags React Native builds it with, `HERMES_ENABLE_INTL=ON`
  included, so `Intl` behaves as it does in production.

## What it costs

A subprocess spawn per test file, and a bundle step per file. In exchange the green check
means something it could not mean before.

Keep Jest or Vitest for what they are good at. Point Argus at the code where engine
fidelity actually decides whether the test told you the truth.
