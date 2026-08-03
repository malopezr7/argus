---
title: Configuration
description: argus.config.ts — where it is looked for, every option it accepts, and which source wins when two disagree.
sidebar:
  order: 2
---

Argus reads an optional config file. Without one it uses built-in defaults, so configuring
anything is opt-in.

```ts title="argus.config.ts"
import { defineConfig } from '@arguslab/argus';

export default defineConfig({
  include: ['src/**/*.test.ts'],
  timeout: 30000,
});
```

That is a TypeScript file with no build step. Node strips the types itself, so there is no
transpiler to install and Argus carries no dependency to read its own config —
[with one consequence](#the-one-typescript-restriction) worth knowing up front.

`defineConfig` is an identity function. It exists only so your editor checks and completes
the object; it does nothing at run time. You can `export default { … }` directly and lose
nothing but the type hint.

## Where the file is looked for

Argus searches **upward** from the working directory. In each directory it tries these
names in order and takes the first that exists:

| # | Name |
|---|---|
| 1 | `argus.config.ts` |
| 2 | `argus.config.mts` |
| 3 | `argus.config.js` |
| 4 | `argus.config.mjs` |
| 5 | `.config/argus.config.ts` |
| 6 | the `argus` field of `package.json` |

Two rules decide the rest.

**First hit wins — configs are never merged.** Two config files side by side is a mistake,
and merging them would make "which settings are in effect?" unanswerable without reading
both and knowing the precedence. A `package.json` field is ignored the moment a config
file exists beside it.

**`package.json` is the ceiling.** The walk stops at the first directory holding one,
whether or not it carries an `argus` field. Without that stop, a stray `argus.config.ts`
in your home directory or a sibling checkout would quietly govern this project's test run.

There is no `.cjs`, `.json`, `.yaml` or `.toml`. Argus is ESM-only, and each extra format
is a parser to carry and another way for two configs to disagree.

### CommonJS projects

`argus.config.ts` works whatever your `package.json` says. Any of the four extensions does;
none of them depends on a `"type"` field. It is worth knowing why, because the mechanism is
visible in one place.

Argus loads the config with Node's own `import()`, and **Node** decides whether a `.ts` or
`.js` file is a module from the nearest `package.json`. In a package declaring
`"type": "commonjs"` — exactly what `npm init -y` writes — it reads `argus.config.ts` as a
CommonJS script, where the `import` line above is a syntax error.

Node already solves this for itself: when a package declares no `type` at all, it detects the
syntax and loads the file as whichever it turns out to be. The only reason that does not
happen here is the explicit `"commonjs"` a scaffolder wrote on your behalf, so Argus applies
the same detection to its own config file, and to nothing else.

The second reading is attempted only after the CommonJS one has already failed to parse. Two
consequences follow, and both are deliberate:

- **A CommonJS config still loads as CommonJS.** `module.exports = { … }` parses on the first
  attempt, so it is never reinterpreted.
- **Your config is executed exactly once.** A parse failure happens *before* evaluation, so no
  line of the file has run when the retry begins. (Trying the module reading first would not
  have this property: `module.exports` parses cleanly as a module and fails only at
  evaluation, by which point the body has already run.)

Nothing is transpiled, no temporary file is written into your project, and the retry does not
reach inside `node_modules` — a dependency that ships CommonJS said so deliberately.

One detail is observable. The retry has to ask the module loader for a URL it has not already
failed, so on that path `import.meta.url` carries an `?argus-esm-retry=1` query:

```ts
import.meta.url                          // file:///app/argus.config.ts?argus-esm-retry=1
fileURLToPath(import.meta.url)           // /app/argus.config.ts          — query dropped
new URL('./data.json', import.meta.url)  // file:///app/data.json         — resolves normally
```

Both idiomatic uses are unaffected; only the raw string differs. If you parse `import.meta.url`
by hand in a config, strip the query — or name the file `argus.config.mts`, which Node reads as
a module with no detection and no retry involved.

### Naming one explicitly

```bash
argus --config config/ci.config.ts
```

Skips the search entirely. A path that does not exist is an error rather than a fall back
to the defaults:

```text
✗ Config error: The config file passed to --config does not exist:
  /home/you/project/nope.config.ts
```

## Options

Every field is optional.

| Option | Type | Default |
|---|---|---|
| [`include`](#include) | `string[]` | `['**/*.test.ts', '**/*.test.tsx']` |
| [`exclude`](#exclude) | `string[]` | `node_modules`, `dist`, `build`, `coverage`, `.git` |
| [`root`](#root) | `string` | the config file's own directory |
| [`timeout`](#timeout) | `number` (ms) | `10000` |
| [`concurrency`](#concurrency) | `number` | CPU count, capped at 8 |
| [`hermes`](#hermes) | `object` | — |

Anything else is rejected. There is no `reporter`, `coverage`, `snapshot`, `watch`, `bail`
or `retry` option — those features do not exist yet, and a key that does nothing is the
worst kind of compatibility obligation. They are on the [roadmap](/reference/roadmap/).

### `include`

Globs selecting test files, resolved against [`root`](#root).

```ts
export default defineConfig({
  include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
});
```

Positional CLI arguments override this entirely: `argus "lib/**/*.test.ts"` runs that glob
and ignores `include`.

### `exclude`

Globs removed from every `include` result.

```ts
export default defineConfig({
  exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/*.e2e.test.ts'],
});
```

:::caution
`exclude` **replaces** the defaults — it does not add to them. Writing
`exclude: ['**/*.e2e.test.ts']` and nothing else re-enables scanning of `node_modules`,
which is slow and will run other people's tests. Restate the defaults you still want.
:::

The default list is `**/node_modules/**`, `**/dist/**`, `**/build/**`, `**/coverage/**`
and `**/.git/**`. A test file compiled into a build directory is a *copy*: discovering it
runs the same test twice, and the copy is the one whose stack traces point at generated
code.

If you deliberately keep tests in one of those directories, name an `exclude` that omits
it:

```ts
// Tests genuinely live in dist/ — keep every other default.
export default defineConfig({
  exclude: ['**/node_modules/**', '**/build/**', '**/coverage/**', '**/.git/**'],
});
```

### `root`

The directory globs resolve against.

```ts
export default defineConfig({
  root: 'packages/app',
  include: ['src/**/*.test.ts'],
});
```

Defaults to the directory holding the config file, **not** the working directory. That is
what makes `argus` behave identically whether you run it from the repo root or from a
subdirectory — a relative value is resolved against the config file for the same reason.

`.config/argus.config.ts` is the one exception: `.config/` is a container for
configuration rather than a project, so a config file there governs its **parent**.

### `timeout`

Per-file Hermes timeout in milliseconds. Must be a positive integer.

```ts
export default defineConfig({ timeout: 30000 });
```

Applies to the whole Hermes process for one file, not to individual tests. There is no
per-test timeout — the unit of isolation is the file, so the unit of timeout is too.

### `concurrency`

How many files may run at once. `1` runs them sequentially.

```ts
export default defineConfig({ concurrency: 4 });
```

Defaults to the CPU count clamped to 8. Each unit is a full Hermes process, so parallelism
is bounded by memory and I/O long before it is bounded by cores.

### `hermes`

Which binary to run on, and how far Argus may go to obtain one.

| Key | Type | Effect |
|---|---|---|
| `path` | `string` | A binary to use outright. Relative paths resolve against the config file. |
| `engine` | `'legacy' \| 'v1'` | Which engine to target. Omit to use whichever the project pins. |
| `provision` | `boolean` | Authorise a source build when nothing else supplies a binary. Off by default. |

`engine` and `provision` steer the [provisioning chain](/hermes/provisioning/) — which
binary Argus goes looking for, and whether it may build one:

```ts
export default defineConfig({
  hermes: { engine: 'legacy', provision: true },
});
```

`path` skips that chain altogether. It is honoured as given and never probed, so naming a
path entitles you to an error about *that* path rather than a silent fallback onto another
binary — which also means `engine` no longer selects anything when `path` is set:

```ts
export default defineConfig({
  hermes: { path: './vendor/hermes' },
});
```

```text
✓ hermes legacy (detected) 0.12.0 · argus.config · /home/you/project/vendor/hermes
```

The engine on that line is read back from the binary's own bytecode version and marked
`detected`. If it disagrees with the engine your project pins you get
[the mismatch warning](/hermes/engines/#the-mismatch-warning) — a warning, not a refusal.

Both `--hermes` and `ARGUS_HERMES` override `hermes.path`: a value committed to the
repository should not beat one a developer typed for this run.

## Precedence

Lowest to highest:

```text
built-in defaults
  → package.json "argus" field
    → config file
      → environment (ARGUS_HERMES)
        → CLI flags
```

The ordering follows how specific and how deliberate each source is. A flag is typed for
one run and always wins over a file that is committed and applies to everybody.

Only one of `package.json` and a config file is ever read — resolution picks exactly one,
so they are shown as separate steps but never both apply.

## When a config is wrong

A config that cannot be used stops the run with **exit code 2**. It never falls back to
the defaults: running under settings you did not choose is the failure this whole layer
exists to prevent, and it would be invisible in the output.

Values are validated, never coerced, and every problem is reported at once:

```text
✗ Config error: Invalid Argus config in /home/you/project/argus.config.ts:
  "reporter" is not a known option. Accepted: include, exclude, root, timeout, concurrency, hermes.
  "timeout" must be a positive integer number of milliseconds, but received -5 (number).
```

Fixing a config one error per run is a waste of your time when the whole object is already
in hand.

## The one TypeScript restriction

Node's type stripping erases types without compiling. `enum` and `namespace` emit real
runtime code, so they cannot be stripped — and they are the only two constructs a
TypeScript config cannot use.

```ts title="argus.config.ts"
enum Speed { Fast = 5000 }        // ✗
export default { timeout: Speed.Fast };
```

```text
✗ Config error: Failed to load the Argus config at /home/you/project/argus.config.ts:
  TypeScript enum is not supported in strip-only mode

  Argus loads a TypeScript config with Node’s native type stripping, which
  erases types without compiling. `enum` and `namespace` emit real code, so
  they cannot be stripped and are the two constructs a config cannot use.
  Use a plain object, a union of string literals, or `as const` instead —
  or move the config to argus.config.js, which is not stripped at all.
```

Use a union of string literals or `as const` instead, or move the file to
`argus.config.js`, which is not stripped at all:

```js title="argus.config.js"
export default { include: ['src/**/*.test.ts'], timeout: 20000 };
```

Everything else TypeScript offers — interfaces, generics, `satisfies`, imported types —
works normally, because all of it erases.

## Types

`defineConfig` is a real export of `@arguslab/argus`, so a config file is checked like any
other source file:

```text
argus.config.ts(4,3): error TS2322: Type 'string' is not assignable to type 'number'.
argus.config.ts(5,13): error TS2322: Type '"v2"' is not assignable to type 'HermesEngine | undefined'.
```

The import is deliberately cheap. It pulls in the type contract and nothing else — not the
runner, not esbuild, not Babel — so a config file costs nothing to load.

Type-checking the *test globals* is a separate step and is not automatic; see
[Installation → TypeScript](/start/installation/#typescript).

## Changes in 0.2.0

Two of these change what an existing project discovers or accepts.

**Discovery now excludes `dist`, `build` and `coverage`.** Previously anything matching
the globs was run, wherever it lived, so a test file emitted by a build was discovered and
executed alongside its source. If you deliberately keep tests in one of those directories,
name an [`exclude`](#exclude) that omits it.

**`--timeout` rejects a value it cannot parse.** `--timeout abc` used to be silently
replaced by the 10 000 ms default, so a typo produced a full green run under a timeout
nobody chose:

```text
✗ Usage error: Invalid --timeout value: "abc". Must be a positive integer (e.g. 5000, 30000).
```

**A discovery bug is fixed.** `node_modules` was matched as a substring rather than a path
segment, so a directory named `my-node_modules-fixtures/` was silently skipped and its
tests reported as a pass. Exclusion now asks about path segments, which was the question
all along.
