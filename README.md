# Argus — Hermes-native tests for React Native

Argus runs React Native unit tests on the **standalone Hermes VM**: the same JavaScript engine used in production React Native, without starting Metro, building a native app, or booting a device/emulator.

The goal is simple: keep the feedback loop close to unit-test speed while catching bugs that only appear on Hermes and would be invisible in Node/V8-based runners.

> **Status:** draft / pre-release. The walking skeleton, core runner, RN native mocks, and synchronous component testing are working.

---

## Quick path

```bash
pnpm install
pnpm typecheck
pnpm exec biome check .
pnpm test
pnpm argus "examples/**/*.test.ts"
pnpm argus "examples/**/*.test.tsx"
```

Argus currently expects a runnable Hermes binary at one of these locations:

1. `--hermes <path>` CLI flag
2. `ARGUS_HERMES=<path>` environment variable
3. `./.hermes/hermes` inside the repo

`.hermes/` is intentionally gitignored. Prebuilt binary distribution is planned but not the default path yet.

---

## Why this exists

Most React Native test suites run on **Node/V8** through Jest or Vitest. That is fast and ergonomic, but it is not the production engine. React Native runs on **Hermes**, and engine differences are real: stack shapes, microtasks, language-feature support, formatting APIs, regex behavior, and runtime edge cases can differ.

Argus fills the middle ground:

| Existing option | Strength | Gap |
|---|---|---|
| Jest / Vitest on Node | Fast, familiar, great DX | Wrong JS engine for RN production |
| On-device / emulator runners | Real app environment | Slow, heavy, requires native build/device |
| Argus | Real Hermes VM at unit-test cost | Not a full RN runtime yet |

Argus is not trying to be “another Jest”. It is a small, Hermes-faithful runner with a Jest-like test surface where that helps ergonomics.

---

## What works today

Current verified baseline:

- Multi-file test discovery with globs.
- Bounded parallel Hermes subprocess execution.
- A small in-Hermes test framework: `describe`, `test`, `it`, `expect`.
- Lifecycle hooks: `beforeEach`, `afterEach`, `beforeAll`, `afterAll`.
- `.skip`, `.only`, `.todo` support.
- Async tests and async matchers through Hermes microtasks.
- Richer matcher set: equality, truthiness, numeric, object, collection, `toThrow`, `.resolves`, `.rejects`, custom `expect.extend`, assertion counting.
- Source-map based stack remapping from `run.argus-bundle.js` back to user source files.
- Hardened result protocol between Hermes and the host process.
- Synchronous React component testing through the isolated `argus` facade: render lifecycle, queries, scoped queries, events, `act`, and automatic cleanup.

Verified locally on 2026-06-30:

```bash
pnpm typecheck                    # pass
pnpm exec biome check .           # pass, with one Biome config deprecation info
pnpm test                         # 308 passed
pnpm argus examples/math.test.ts examples/matchers.test.ts examples/jest-api.test.ts
```

---

## Current SDD iteration

The active iteration is:

> **Phase 3 · item 7 — synchronous component testing on real Hermes**

Component tests import the facade explicitly; plain unit tests remain React-free:

```tsx
import { fireEvent, render, screen, within } from 'argus';
import { Pressable, Text, View } from 'react-native';

render(
  <View testID="panel">
    <Pressable onPress={() => console.log('pressed')}>
      <Text>Submit</Text>
    </Pressable>
  </View>,
);

const panel = screen.getByTestId('panel');
fireEvent.press(within(panel).getByText('Submit'));
```

Held node references and `within(scope)` are snapshots of the tree at query time. After an
update, re-query through `screen` and create a fresh `within` scope before making assertions or
dispatching another event.

Supported synchronous surface:

- `render`, `rerender`, `unmount`, `screen`, and `within`.
- `getBy*`, `getAllBy*`, `queryBy*`, and `queryAllBy*` for text, test ID, role, placeholder text, and display value.
- `fireEvent`, `fireEvent.press`, `fireEvent.changeText`, synchronous `act`, and automatic root cleanup.

Async query APIs (`waitFor`, `findBy*`), `userEvent`, fake timers, Suspense guarantees, layout, and native-platform fidelity remain out of scope.

### `@argus/rntl`

The synchronous component-testing facade is maintained separately in `@argus/rntl` as a
stopgap. Test code continues to import its public surface from `'argus'`; the bundler maps that
specifier to the dedicated package. When upstream RNTL v14 on `test-renderer` becomes bundleable
on the supported Hermes envelope, this package can be deprecated without expanding framework core.

---

## Architecture in one screen

```text
Host process (Node today)
  args
    → resolve framework paths
    → resolve Hermes binary
    → discover test files
    → for each file, bounded by concurrency:
        bundle with esbuild
        → write sealed bundle to temp file
        → spawn standalone hermes
        → parse framed result line
        → remap stacks with source maps
    → aggregate results
    → render CLI report
    → exit with worst-case code

Hermes subprocess
  sealed IIFE bundle:
    polyfills
    + Argus framework
    + user test file
    + virtual entry calling run(<private nonce>)

Output channel
  stdout contains user logs plus one framed result line:
    __ARGUS_RESULT__:<nonce>:<json>
```

The important design decision: **Hermes cannot ask the host for modules at runtime**. Everything must be bundled up front. This makes the run deterministic, isolated per file, and easy to parallelize.

---

## Package map

| Package | Role | Rule |
|---|---|---|
| `@argus/core` | Pure domain types, ports, result protocol parser | No adapter/runtime imports |
| `@argus/framework` | Runs inside Hermes: globals, runner, matchers, result emission | Protect the result channel |
| `@argus/rntl` | Synchronous component-testing facade exposed through the `argus` alias | Maintained separately as a replaceable stopgap |
| `@argus/esbuild` | Bundles polyfills + framework + tests into one IIFE | Owns syntax lowering and virtual entry |
| `@argus/hermes` | Spawns the standalone Hermes VM on a temp file | Never use stdin; stdin triggers Hermes REPL mode |
| `@argus/sourcemap` | Remaps Hermes bundle stack frames to original source files | Must be total: never throw during reporting |
| `@argus/cli` | Composition root | Wires adapters; keeps domain pure |
| `@argus/reporter-cli` | Terminal output and exit-code policy | Reports test failures separately from infra failures |

---

## Result protocol

Argus treats the Hermes process as an untrusted same-realm execution environment. User tests can override globals and pollute prototypes, so the result channel is deliberately hardened.

Key properties:

- The framework captures required primordials before user tests run.
- Each bundle gets a private random nonce.
- The host accepts only one exact framed line containing that nonce.
- Non-zero Hermes exits are infrastructure failures, even if a frame was printed earlier.
- The framework emits JSON through a hand-written serializer, not `JSON.stringify`.
- The serializer avoids array methods, iterators, and prototype-sensitive behavior.

That result-channel code lives in `packages/framework/src/index.ts`. Treat it as a high-integrity boundary.

---

## Working with the repo

### Run the normal gates

```bash
pnpm typecheck
pnpm exec biome check .
pnpm test
```

### Run tests on real Hermes

```bash
pnpm argus "examples/**/*.test.ts"
pnpm argus examples/math.test.ts
pnpm argus examples/math-failing.test.ts
```

`examples/` contains Hermes fixtures. They are meant to run through `pnpm argus`, not Vitest.

### Useful scripts

| Command | Purpose |
|---|---|
| `pnpm typecheck` | TypeScript checks across workspace packages |
| `pnpm exec biome check .` | Formatting + lint checks |
| `pnpm test` | Vitest unit/integration suite on Node |
| `pnpm argus <glob>` | Run tests through the standalone Hermes VM |
| `pnpm phase1` | Historical walking-skeleton script |

### Do not use

- Do not use `npm`, `npx`, `bun`, or Yarn for this repo. Use `pnpm`.
- Do not rely only on Vitest for framework behavior. Real Hermes fixtures catch bundling/runtime bugs Node will miss.
- Do not run Hermes through stdin. Use file mode only.

---

## Development constraints

These constraints are intentional and protect the project from subtle runtime bugs:

- Keep `@argus/core` pure and adapter-free.
- Keep files around or below ~500 LOC; split modules when needed.
- Keep the in-Hermes code compatible with the Hermes syntax envelope.
- In result-channel code, avoid `JSON.stringify`, array methods, iterators, and prototype-sensitive APIs.
- Prefer index loops in runner/deep-equality/serializer paths.
- Never change the result serializer casually.
- New user-facing features need at least one real `pnpm argus ...` fixture when they affect bundled Hermes behavior.

---

## Roadmap

| Area | Status |
|---|---|
| Walking skeleton: bundle → Hermes → framed result → report | Done |
| Test discovery and multi-file runs | Done |
| Bounded parallelism | Done |
| Richer `expect` matchers | Done |
| Jest-like runner API: hooks, `it`, `.skip`, `.only`, `.todo`, async, `expect.extend`, assertion counting | Done |
| Source-map stack remapping | Done |
| RN native mocks + `argus.fn()` / spies / call matchers | Done |
| Argus-owned synchronous component testing | Done |
| Snapshots | Pending |
| Coverage | Pending |
| Watch mode | Pending |
| Prebuilt Hermes distribution and CI matrix | Deferred until publish path |

---

## What Argus is not

Argus is not a full React Native runtime today.

It does not currently provide:

- Metro runtime behavior.
- Native app lifecycle.
- Device APIs.
- Real UI rendering.
- Layout calculation.
- A complete Jest compatibility layer.

That is by design. The current target is **Hermes engine fidelity for unit-level tests**, then carefully adding RN-specific surfaces where they are valuable and testable.

---

## Contributing notes

If you want to pick up work, start here:

1. Run the normal gates.
2. Run at least one passing and one failing Hermes fixture.
3. Read `packages/core/src/domain/types.ts` to understand the domain model.
4. Read `packages/framework/src/index.ts` before touching result emission.
5. Read `packages/cli/src/cli.ts` to understand the composition flow.
6. Check the current roadmap item before adding new surface area.

Before claiming a change is done, report the exact commands you ran and whether they passed.

---

## License

No license has been declared yet.
