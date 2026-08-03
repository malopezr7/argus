# Argus

[![CI](https://github.com/malopezr7/argus/actions/workflows/ci.yml/badge.svg)](https://github.com/malopezr7/argus/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

React Native tests on the real Hermes engine. No device, no Metro, no emulator.

Argus bundles each `*.test.ts` into a sealed IIFE with esbuild, runs it on the
standalone `hermes` VM as a subprocess, and parses the result back on the Node
host. That is the same engine your users run, at roughly the cost of a unit test.

> **Pre-release.** Argus is at v0.2.1. It installs and runs, and the surface it
> exposes is still free to change. See [Status](#status).

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

Argus is pre-1.0. The runner, the engine targeting, automatic Hermes
provisioning, and component testing all work; the API is still free to change
between minor versions, and the roadmap below is the honest picture of what is
missing.

## Installing

You need **Node 24 or newer**.

```bash
npm install --save-dev @arguslab/argus
```

One package, one binary — 30 files, 68 kB packed, 300 kB installed. `core`, the
adapters, and the Hermes-side framework are internal seams rather than an API,
so they are not published separately.

React is **not** a dependency. It is an optional peer, needed only if you write
component tests:

```bash
npm install --save-dev react test-renderer
```

A suite that never imports `argus` never pulls React into the bundle, so a
pure-TypeScript project runs with no React installed at all. Import `argus`
without them and the run stops at the bundle step rather than guessing:

```
✘ [ERROR] Could not resolve "react"
✗ INFRASTRUCTURE FAILURE [bundle] Build failed with 5 errors
```

That is exit **2**, an infrastructure failure — never a red test.

### TypeScript

Test globals (`describe`, `expect`) and the virtual `argus` module are declared
in the package. This is not zero-config, and pretending otherwise wastes an
afternoon: TypeScript only auto-loads ambient declarations from
`node_modules/@types/*`, and Argus is not published under that scope. Point it
at them once — either in `tsconfig.json`:

```json
{ "compilerOptions": { "types": ["@arguslab/argus"] } }
```

or, leaving `compilerOptions` alone, with one line in a `.d.ts` your `include`
already covers:

```ts
/// <reference types="@arguslab/argus" />
```

Both are verified. Without one of them you get `Cannot find name 'describe'` and
`Cannot find module 'argus'` — at type-check time only; the run itself is
unaffected.

## Running it

Argus reads the Hermes version your project pins and provisions a matching VM.
Run it with your project as the working directory:

```bash
cd ~/my-rn-app
npx argus "src/**/*.test.ts"
```

On a clean machine — no binary, no cache — on React Native 0.86 or 0.87, that
prints:

```
✓ hermes v1 hermes-v250829098.0.16 · prebuilt darwin-arm64 · /Users/you/.argus/cache/hermes-hermes-v250829098.0.16/build/bin/hermes
sum
  ✓ adds

1 passed, 0 failed, 0 todo, 1 total (0 ms in Hermes)
  ✓ sum.test.ts

1 files: 1 passed, 0 failed
1 tests: 1 passed, 0 failed, 0 todo
```

On other React Native versions the first line names a different source — the VM
bundled inside `react-native`, or a build you authorised with `--provision`. See
[Getting a Hermes binary](#getting-a-hermes-binary) for which one applies to you.

### Working on Argus itself

From a clone, the same CLI runs straight from source — there is no build step in
the development loop:

```bash
git clone https://github.com/malopezr7/argus.git
cd argus
corepack enable
pnpm install
```

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

Argus runs **the engine your React Native release ships by default**, which is not
always the newest one it pins. RN 0.82 and 0.83 pin V1 *and* legacy but ship
legacy — V1 is an opt-in you reach by building RN from source — so on those
versions Argus targets legacy. Testing a VM those apps never execute would be
the exact gap this tool exists to close. `--engine` overrides it either way.

| | Legacy | Hermes V1 |
| --- | --- | --- |
| HBC bytecode version | 96 | 98 |
| React Native | 0.69 – 0.86 | 0.83 – (default from 0.84) |
| `class`, private fields, `static {}` | Cannot parse | Native |
| Argus runs it by default on | RN ≤ 0.83 | RN 0.84+ |

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

Argus walks this chain and takes the first source that has a binary. Steps 1–5
need nothing from you; step 6 does, and says so before it runs.

| # | Source | Notes |
| --- | --- | --- |
| 1 | `--hermes <path>` / `ARGUS_HERMES` | Always honoured, never probed |
| 2 | `./.hermes/hermes` in the project | Vendored by you |
| 3 | `~/.argus/cache` | Anything provisioned earlier |
| 4 | The VM inside the `react-native` tarball | Legacy only, macOS, RN 0.73 – 0.82 |
| 5 | **A prebuilt from this repository's GitHub Releases** | Downloaded, checksum-verified — **only where one is published**, see below |
| 6 | A source build | **Opt-in behind `--provision`**, needs `git`, `cmake`, `ninja` |

Which step you land on depends on the Hermes version your project pins and on
your OS. On React Native 0.86 or 0.87 it is step 5 and there is nothing to
install; on 0.83–0.85 no release has been cut yet and you need step 6.

Every run prints one line naming what it used, so a CI log always says which
engine produced the result:

```
✓ hermes v1 hermes-v250829098.0.16 · prebuilt darwin-arm64 · /Users/you/.argus/cache/…/hermes
```

### What is actually downloadable today

Step 5 is the only step that needs no tools and no waiting, and it does **not**
cover every project. A prebuilt has to be published for the exact Hermes version
your React Native pins, and so far exactly one release exists:
[`hermes-bin-v250829098.0.16`](https://github.com/malopezr7/argus/releases/tag/hermes-bin-v250829098.0.16).

| Your React Native | Pins | On a clean machine you get |
| --- | --- | --- |
| **0.87** | Hermes V1 `250829098.0.16` | **Prebuilt download.** Nothing to install |
| **0.86** | Hermes V1 `250829098.0.16` | **Prebuilt download.** Nothing to install |
| 0.85 | Hermes V1 `250829098.0.10` | No release cut yet → `--provision` |
| 0.84 | Hermes V1 `250829098.0.9` | No release cut yet → `--provision` |
| 0.83 | legacy `v0.14.1` | No release cut yet → `--provision` |
| 0.78 – 0.82 | legacy, date-based ref | **macOS:** the VM inside `react-native`, free. **Linux:** `--provision` |

Below 0.78 there is no fallback table, but your install is what Argus actually
reads and `sdks/.hermesversion` has existed since RN 0.69 — so 0.73 – 0.77 on
macOS generally works off the bundled VM too.

A date-based pin (`2025-07-07-RNv0.81.0`) and a bare commit SHA can never have a
prebuilt: a release has to be *named* by a version, and those are git refs. That
is a permanent property of those React Native releases, not a backlog item.

When no source applies, Argus does not guess. It fails with exit 2 and prints
every step it tried and why — including the exact 404 — plus the four commands
that would fix it.

### Linux needs a recent glibc

The published Linux archives are glibc builds that currently require
**glibc 2.38**. They do not start below that — the loader rejects them before
any Argus code runs.

| Distribution | glibc | Published binary |
| --- | --- | --- |
| Ubuntu 24.04 LTS and newer | 2.39+ | Runs |
| Fedora 39+, Debian 13 | 2.38+ | Runs |
| **Ubuntu 22.04 LTS** | 2.35 | **Does not start** |
| **Debian 12** | 2.36 | **Does not start** |
| **Amazon Linux 2023, RHEL 9** | 2.34 | **Does not start** |
| **Alpine and other musl distros** | none | **Never** — these are glibc builds |

The build now happens on the oldest supported runner and a CI gate reads the
glibc requirement straight out of the ELF and fails the build above 2.35, which
brings Ubuntu 22.04, Debian 12 and Amazon Linux 2023 back. **That fix has not
shipped yet** — it landed after the current release was cut, so the archives on
the release page are still the 2.38 ones. Until they are re-cut, use
`--provision` or `--hermes` on those distributions.

musl is not affected by any of that. A glibc build cannot run on Alpine, and
choosing a different builder does not change it.

### Speed, once a prebuilt applies

Measured on this machine, RN 0.86, empty cache: **2.3 s** for the first run
including a ~7 MB download, **0.62 s** once the cache is warm. The first number
is network-bound and will move; the warm one is the one you live with. With the
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

Query results are live views of the element, not snapshots. A held node and a
`within(scope)` handle stay valid across an update: the node reports the current
props and fires the current handler, so a button can be pressed twice without
re-querying. A node whose element an update removed is detached and keeps
reporting what it last rendered. On v0.2.0 — the current release on npm — these
are still snapshots; live views land in the next patch release.

### Not there yet

Snapshots, coverage, watch mode, `waitFor` / `findBy*`, `userEvent` and fake
timers. The esbuild target, module aliases and the JSX runtime are still fixed,
and a zero-match run exits 2 — there is no `passWithNoTests`. See the
[roadmap](ROADMAP.md).

Argus is also not a React Native runtime: no Metro semantics, no native
lifecycle, no device APIs, no layout. The target is engine fidelity for
unit-level tests.

## Configuring

Optional. Without a config file Argus uses built-in defaults, so most projects
need nothing.

```ts
// argus.config.ts
import { defineConfig } from '@arguslab/argus';

export default defineConfig({
  include: ['src/**/*.test.ts'],
  timeout: 30000,
});
```

TypeScript, with no build step and no added dependency — Node strips the types
itself. `defineConfig` is an identity function; it exists so your editor checks
the object.

This works whatever your `package.json` says. Node reads a `.ts` file in a
package declaring `"type": "commonjs"` — what `npm init -y` writes — as a
CommonJS script, where the `import` above would be a syntax error; Argus reloads
it as the module it is. That happens only after the CommonJS reading has failed
to parse, so a config written as `module.exports` still loads as CommonJS, and
either way the file is executed exactly once.

Argus searches upward from the working directory for `argus.config.ts`, `.mts`,
`.js`, `.mjs`, `.config/argus.config.ts`, then an `argus` field in
`package.json`. First hit wins, configs are never merged, and the walk stops at
the first `package.json` so a stray config elsewhere on the machine cannot
govern your run. `--config <path>` names one directly.

| Option | Default |
| --- | --- |
| `include` | `**/*.test.ts`, `**/*.test.tsx` |
| `exclude` | `node_modules`, `dist`, `build`, `coverage`, `.git` |
| `root` | the config file's own directory |
| `timeout` | `10000` ms |
| `concurrency` | CPU count, capped at 8 |
| `hermes` | `{ path, engine, provision }` |

Precedence runs defaults → `package.json` → config file → environment → CLI
flags, so a flag always wins. A config that is invalid stops the run with exit
2 rather than falling back to defaults.

One restriction worth knowing before you start: type stripping erases types
without compiling, so `enum` and `namespace` cannot appear in `argus.config.ts`.
Argus catches that and says so; `argus.config.js` is the escape hatch.

Full reference: **[Configuration](https://argus-hermes.pages.dev/cli/configuration/)**.

### Upgrading from 0.1.x

Two behaviour changes came with the config work.

- **Discovery now excludes `dist`, `build` and `coverage`.** Previously anything
  matching the globs ran, wherever it lived, so a test compiled into a build
  directory was discovered and executed alongside its source. If you keep tests
  in one of those directories on purpose, set `exclude` explicitly — note that
  it *replaces* the defaults rather than adding to them.
- **`--timeout` rejects a value it cannot parse.** `--timeout abc` used to be
  silently replaced by the 10 000 ms default, so a typo produced a green run
  under a timeout nobody chose.

Also fixed: `node_modules` was matched as a substring rather than a path
segment, so a directory named `my-node_modules-fixtures/` was silently skipped
and its tests reported as a pass.

## CLI

```
argus [globs...]
```

Globs default to `**/*.test.ts` and `**/*.test.tsx`.

| Flag | Default | Purpose |
| --- | --- | --- |
| `-t, --timeout <ms>` | `10000` | Per-file Hermes timeout |
| `-c, --concurrency <n>` | CPU-based, capped at 8 | Files in parallel; `1` is sequential |
| `--config <path>` | searched for | Config file to use, instead of searching |
| `--hermes <path>` | — | Hermes binary; overrides `ARGUS_HERMES` |
| `--engine <legacy\|v1>` | The engine the project's RN release ships by default | Target engine |
| `--provision` | off | Allow building Hermes from source |
| `-h, --help` | — | Show help |

`ARGUS_HERMES` sets the binary path from the environment. Flags override
everything a config file sets — see [Configuring](#configuring).

Exit codes are worst-case across the run: **0** all passed, **1** a test failed,
**2** infrastructure — timeout, protocol violation, or no binary available. Test
failures and infrastructure failures are reported separately, so a broken
provisioning step can never look like a red test.

## Architecture

Hexagonal. `@arguslab/core` is pure and adapter-free; adapters do the I/O;
`@arguslab/cli` is the only composition root.

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

These are internal seams, not an API — all eight are private, and `@arguslab/argus`
is the only thing published.

| Package | Role |
| --- | --- |
| `@arguslab/core` | Domain types, ports, result-protocol parser. No I/O |
| `@arguslab/framework` | Runs *inside* Hermes: globals, runner, matchers, result emission |
| `@arguslab/esbuild` | Bundles polyfills + framework + test into one IIFE |
| `@arguslab/hermes` | Engine resolution, provisioning adapters, subprocess spawn |
| `@arguslab/sourcemap` | Remaps Hermes frames to original sources |
| `@arguslab/rntl` | The synchronous component-testing surface behind `'argus'` |
| `@arguslab/cli` | Composition root |
| `@arguslab/reporter-cli` | Terminal output and exit-code policy |

The two halves ship differently, and the difference is the design. The host side
is bundled into one ESM binary: it is a program, not a library, so collapsing the
seam costs the user nothing. `framework` and `rntl` are never imported by Node at
all — their paths are handed to esbuild, which compiles them on your machine
against the engine your project pins. So they ship as **TypeScript runtime assets
inside the tarball**, copied verbatim. Compiling them at publish time would bake
in one engine's syntax envelope and defeat the point.

The result channel is treated as a high-integrity boundary. A test file can
pollute prototypes and override globals, so the framework captures primordials
before user code runs, frames output with a private per-run nonce, and
serialises by hand rather than through `JSON.stringify`. A test must not be able
to forge its own verdict.

## Documentation

Full docs: **[argus-hermes.pages.dev](https://argus-hermes.pages.dev)** — installation,
matchers, mocks, component testing, the provisioning chain, and the internals.

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
