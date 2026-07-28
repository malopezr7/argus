# Argus

[![CI](https://github.com/malopezr7/argus/actions/workflows/ci.yml/badge.svg)](https://github.com/malopezr7/argus/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

React Native tests on the real Hermes engine. No device, no Metro, no emulator.

Argus bundles each `*.test.ts` into a sealed IIFE with esbuild, runs it on the
standalone `hermes` VM as a subprocess, and parses the result back on the Node
host. That is the same engine your users run, at roughly the cost of a unit test.

> **Pre-release.** Argus cannot be installed from a package registry yet. See
> [Status](#status) for what that means in practice and how to run it today.

## Why

Most React Native suites run on Node through Jest or Vitest. That is fast and
familiar, and it is the wrong engine. Your app ships on Hermes, and the two
differ in ways tests are supposed to catch: stack shapes, microtask ordering,
language-feature support, regex and formatting behaviour, error messages.

| Approach | Engine | Cost |
| --- | --- | --- |
| Jest / Vitest on Node | V8 — not what ships | Seconds |
| On-device / emulator runner | Real, in a real app | Minutes, needs a native build |
| **Argus** | **Real Hermes, standalone VM** | **Seconds** |

Argus is not trying to be another Jest. It is a small runner that is faithful to
the engine, with a Jest-shaped surface where that costs nothing.

## Status

Argus is pre-1.0 and **not installable from npm**. This is not a packaging
detail waiting on a release button — no package emits build output. Several
packages point `main` at `./src/*.ts`, which Node cannot import, and the rest
point at a `dist/` nothing generates. The CLI also resolves its runtime inputs
through the monorepo layout, so it would not find the framework under
`node_modules` even if it loaded.

Making it installable is the whole of the [v0.1.0 milestone](ROADMAP.md#v010--make-it-installable),
and no test-authoring features ship before it.

What *does* work, today, is everything below: the runner, the engine targeting,
and automatic Hermes provisioning. You run it from a clone.

## Running it

You need **Node 24 or newer** and **pnpm**.

```bash
git clone https://github.com/malopezr7/argus.git
cd argus
corepack enable
pnpm install
```

### Against your own React Native project

Argus reads the Hermes version your project pins and provisions a matching VM.
Run it with your project as the working directory:

```bash
cd ~/my-rn-app
/path/to/argus/node_modules/.bin/tsx /path/to/argus/packages/cli/src/cli.ts
```

On a clean machine — no binary, no cache — that prints:

```
✓ hermes v1 hermes-v250829098.0.16 · prebuilt darwin-arm64 · /Users/you/.argus/cache/hermes-hermes-v250829098.0.16/build/bin/hermes
sum
  ✓ adds

1 passed, 0 failed, 0 todo, 1 total (0 ms in Hermes)
  ✓ sum.test.ts

1 files: 1 passed, 0 failed
1 tests: 1 passed, 0 failed, 0 todo
```

The `tsx` invocation is ugly on purpose — it is the honest one. `node
--experimental-strip-types` fails on the same file, because the workspace
resolves `.js` specifiers to `.ts` sources. That is the missing build step,
visible from the outside.

### The repository's own examples

`examples/` holds fixtures that run on real Hermes. The repository has no React
Native install of its own, so there is no engine pin to read and nothing to
provision automatically — point Argus at a binary:

```bash
ARGUS_HERMES=/path/to/hermes pnpm argus examples/math.test.ts
```

```
✓ hermes legacy (detected) 0.12.0 · ARGUS_HERMES · /path/to/hermes
math
  ✓ adds small numbers
  ✓ resolves async (microtask)
  nested
    ✓ multiplies

3 passed, 0 failed, 0 todo, 3 total (0 ms in Hermes)
  ✓ math.test.ts

1 files: 1 passed, 0 failed
3 tests: 3 passed, 0 failed, 0 todo
```

The first line describes whichever binary you handed it. With no project to read
a pin from, the engine is inferred from the binary's own bytecode version and
marked `detected` — the two cases are never conflated.

Some fixtures fail on purpose. `examples/math-failing.test.ts` exists to show
stack remapping — user frames come back as source, bundle frames stay as bundle
(paths elided):

```
    Error: expect(1).toBe(2)
        at assert (…/argus-8GZOw3/run.argus-bundle.js:1064:24)
        at toBe (…/argus-8GZOw3/run.argus-bundle.js:1083:15)
        at apply (native)
        at counted (…/argus-8GZOw3/run.argus-bundle.js:392:26)
        at anonymous (examples/math-failing.test.ts:12:15)
        …
```

## The engine

From React Native 0.83 on, RN pins **two** Hermes engines: a legacy one and
**Hermes V1** (Static Hermes). RN 0.84 made V1 the default. **RN 0.87 dropped
legacy entirely.**

Argus targets V1 by default and treats legacy as compatibility mode.

| | Legacy | Hermes V1 |
| --- | --- | --- |
| HBC bytecode version | 96 | 98 |
| React Native | 0.69 – 0.86 | 0.83 – (default from 0.84) |
| `class`, private fields, `static {}` | Cannot parse | Native |
| Argus `--engine` | `legacy` | `v1` (default) |

The bytecode version is the reliable discriminator, and it is why a mismatch is
not a silent quality problem: a VM refuses foreign bytecode outright
(`Wrong bytecode version. Expected 98 but got 96`) rather than degrading. Argus
checks it on every provisioned binary and warns loudly when the engine is not
the one the project targets.

This is also why running legacy against a modern project is not a conservative
choice. On RN 0.87, `class` and private fields reach the engine as written.
A legacy-based runner has to lower them first, which means testing a pipeline
React Native no longer uses.

### Fidelity is verified, not asserted

React Native compiles your bundle to HBC at build time and interprets it on
device. Argus uses the same model, so "same engine" has to be more than a claim.

Every prebuilt Argus publishes is gated in CI: the freshly built `hermesc` and
the official `hermes-compiler` npm package **React Native itself ships** must
emit a **byte-identical `.hbc`** for the same source, or the build fails and
nothing is released.

That gate runs on `darwin` and `linux-x64`. On `linux-arm64` it is skipped with
a logged reason — React Native ships no arm64 compiler to compare against.

## Getting a Hermes binary

Argus provisions one. You do not build or download anything by hand. It walks
this chain and takes the first source that has a binary:

| # | Source | Notes |
| --- | --- | --- |
| 1 | `--hermes <path>` / `ARGUS_HERMES` | Always honoured, never probed |
| 2 | `./.hermes/hermes` in the project | Vendored by you |
| 3 | `~/.argus/cache` | Anything provisioned earlier |
| 4 | The VM inside the `react-native` tarball | Legacy only, macOS, RN 0.73 – 0.82 |
| 5 | **A prebuilt from this repository's GitHub Releases** | Downloaded, checksum-verified |
| 6 | A source build | **Opt-in behind `--provision`** |

Every run prints one line naming what it used, so a CI log always says which
engine produced the result:

```
✓ hermes v1 hermes-v250829098.0.16 · prebuilt darwin-arm64 · /Users/you/.argus/cache/…/hermes
```

Prebuilts are published for `darwin-arm64`, `darwin-x64`, `linux-x64` and
`linux-arm64`. Windows is not supported yet.

Measured on a clean project with no binary and no cache: **3.6 s** for the first
run including the download, **0.62 s** for the second from cache. With the
network cut, the cached run still passes.

The source build is last and opt-in for a reason. It clones and compiles Hermes,
takes minutes rather than seconds, and needs `git`, `cmake` and `ninja`. That
should never be a surprise consequence of typing a test command:

```bash
argus --provision
```

Argus downloads and then executes these binaries, so how they are verified is a
security property, not a footnote — see [SECURITY.md](SECURITY.md) for the
checksum and build-provenance checks, and how to run them yourself.

## Writing tests

Globals are installed by the framework; no import is needed for the core API.

```ts
describe('cart', () => {
  beforeEach(() => reset());

  test('totals line items', () => {
    expect(total([2, 3])).toBe(5);
  });

  test.skip('applies a coupon', () => {});

  test('loads remotely', async () => {
    await expect(fetchCart()).resolves.toEqual({ items: [] });
  });
});
```

| Area | Supported |
| --- | --- |
| Structure | `describe`, `test` / `it`, `.skip`, `.only`, `.todo` |
| Hooks | `beforeAll`, `afterAll`, `beforeEach`, `afterEach` |
| Async | `async` tests, `.resolves`, `.rejects` |
| Matchers | Equality, truthiness, numeric, object, collection, `toThrow` |
| Extension | `expect.extend`, assertion counting |
| Mocks | `argus.fn()`, `argus.spyOn()`, `toHaveBeenCalled*` |
| Native modules | `argus.mockNativeModule(name, factory)`, `argus.resetNativeModules()` |
| Failures | Stacks source-mapped back to your TypeScript |

### Component testing

Real React 19, running on Hermes. The API is synchronous and RNTL-shaped, and it
comes from a virtual `'argus'` import — plain unit tests stay React-free:

```tsx
import { fireEvent, render, screen, within } from 'argus';
import { Pressable, Text, View } from 'react-native';

render(
  <View testID="panel">
    <Pressable onPress={submit}>
      <Text>Submit</Text>
    </Pressable>
  </View>,
);

fireEvent.press(within(screen.getByTestId('panel')).getByText('Submit'));
```

Available: `render`, `rerender`, `unmount`, `screen`, `within`, `fireEvent`,
`act`, and `getBy*` / `getAllBy*` / `queryBy*` / `queryAllBy*` over text, test
ID, role, placeholder text and display value.

Held node references and `within(scope)` are snapshots of the tree at query
time. After an update, re-query through `screen` before asserting again.

### Not there yet

Snapshots, coverage, watch mode, `waitFor` / `findBy*`, `userEvent`, fake
timers, and a config file. Globs, timeout, concurrency and aliases are CLI flags
and defaults for now. See the [roadmap](ROADMAP.md).

Argus is also not a React Native runtime: no Metro semantics, no native
lifecycle, no device APIs, no layout. The target is engine fidelity for
unit-level tests.

## CLI

```
argus [globs...]
```

Globs default to `**/*.test.ts` and `**/*.test.tsx`.

| Flag | Default | Purpose |
| --- | --- | --- |
| `-t, --timeout <ms>` | `10000` | Per-file Hermes timeout |
| `-c, --concurrency <n>` | CPU-based, capped at 8 | Files in parallel; `1` is sequential |
| `--hermes <path>` | — | Hermes binary; overrides `ARGUS_HERMES` |
| `--engine <legacy\|v1>` | The engine the project pins, preferring `v1` | Target engine |
| `--provision` | off | Allow building Hermes from source |
| `-h, --help` | — | Show help |

`ARGUS_HERMES` sets the binary path from the environment.

Exit codes are worst-case across the run: **0** all passed, **1** a test failed,
**2** infrastructure — timeout, protocol violation, or no binary available. Test
failures and infrastructure failures are reported separately, so a broken
provisioning step can never look like a red test.

## Architecture

Hexagonal. `@argus/core` is pure and adapter-free; adapters do the I/O;
`@argus/cli` is the only composition root.

```
Host (Node)
  args → resolve engine → provision Hermes → discover files
       → per file, bounded by concurrency:
             esbuild → sealed IIFE
           → spawn hermes on a temp file
           → parse the framed result line
           → remap stacks through source maps
       → aggregate → report → exit

Hermes subprocess
  one sealed bundle: polyfills + framework + your test + a virtual entry

Result channel
  stdout: your logs, plus exactly one framed line
  __ARGUS_RESULT__:<nonce>:<json>
```

The load-bearing constraint: **Hermes cannot ask the host for modules at
runtime.** Everything is bundled up front, which makes each run deterministic,
isolated per file, and trivially parallel.

| Package | Role |
| --- | --- |
| `@argus/core` | Domain types, ports, result-protocol parser. No I/O |
| `@argus/framework` | Runs *inside* Hermes: globals, runner, matchers, result emission |
| `@argus/esbuild` | Bundles polyfills + framework + test into one IIFE |
| `@argus/hermes` | Engine resolution, provisioning adapters, subprocess spawn |
| `@argus/sourcemap` | Remaps Hermes frames to original sources |
| `@argus/rntl` | The synchronous component-testing surface behind `'argus'` |
| `@argus/cli` | Composition root |
| `@argus/reporter-cli` | Terminal output and exit-code policy |

The result channel is treated as a high-integrity boundary. A test file can
pollute prototypes and override globals, so the framework captures primordials
before user code runs, frames output with a private per-run nonce, and
serialises by hand rather than through `JSON.stringify`. A test must not be able
to forge its own verdict.

## Documentation

- [ROADMAP.md](ROADMAP.md) — what ships next, and what is deliberately out of scope
- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, gates, architecture rules
- [SECURITY.md](SECURITY.md) — reporting, and verifying a downloaded binary
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

MIT — see [LICENSE](LICENSE).

Argus builds and redistributes the Hermes VM from
[facebook/hermes](https://github.com/facebook/hermes), also MIT. Those builds
statically link `llvh`, an LLVM fork vendored in the Hermes tree and covered by
Apache-2.0 WITH LLVM-exception.
