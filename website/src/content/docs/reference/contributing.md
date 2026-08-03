---
title: Contributing
description: Where the canonical contributor docs live, the one rule people skip, and how to work on this site.
sidebar:
  order: 3
---

Argus lives at [github.com/malopezr7/argus](https://github.com/malopezr7/argus). MIT
licensed.

## The canonical documents

These live in the repository and are the source of truth. This page does not restate them,
because two copies of the same rules drift:

| Document | Covers |
|---|---|
| [CONTRIBUTING.md](https://github.com/malopezr7/argus/blob/main/CONTRIBUTING.md) | Setup, the Hermes binary, the gates, architecture rules, commits and pull requests |
| [SECURITY.md](https://github.com/malopezr7/argus/blob/main/SECURITY.md) | Supported versions and how to report a vulnerability privately |
| [CODE_OF_CONDUCT.md](https://github.com/malopezr7/argus/blob/main/CODE_OF_CONDUCT.md) | Expected conduct |

## The rule people skip

Run the gates — and the fourth one is not optional:

```bash
pnpm typecheck
pnpm exec biome check .
pnpm test
ARGUS_HERMES=/path/to/hermes pnpm argus "examples/**/*.test.ts"
```

The first three should be silent; `pnpm test` currently runs 1140 tests across 83 files with
2 skipped.

The fourth needs `ARGUS_HERMES`, or a binary vendored at `./.hermes/hermes`. This repository
has no `react-native` install, so Argus has no engine pin to read and cannot provision
anything for itself — a fresh clone running `pnpm argus` exits 2 with `no engine resolved`.
That is expected, not a broken checkout.

`pnpm test` runs on **Node**. Argus ships code that runs on **Hermes**, after being lowered
by esbuild. A green Node suite is not evidence about the artifact that actually ships.

The bug that made this a rule: esbuild lowers a loop-scoped `const` to `var` for the Hermes
target, so a closure created inside the loop captures the **last** iteration's value.

```ts
// Correct in source. Wrong once lowered.
for (const key of keys) {
  const original = target[key];
  target[key] = (...args) => wrap(original, args); // every wrapper gets the LAST original
}
```

A matcher-wrapping loop shaped exactly like that made every wrapped matcher call the same
method. Every Node unit test passed. It failed only on a real Hermes run, because **the bug
does not exist until the bundle is lowered**, and Node never sees the lowered bundle.

Anything touching bundling, the framework, matchers or the runner needs a real `pnpm argus`
run. New user-facing behaviour that affects the bundled Hermes side needs a fixture in
`examples/`.

## Changing what gets published

Eight workspace packages, one published artifact. If you touch `packaging/`,
`scripts/build-package.ts`, `packages/cli/src/paths.ts`, or anything else that decides what
lands in the tarball, stage it and look:

```bash
pnpm build          # → dist/, the directory that IS the tarball
npm pack ./dist     # file list, packed and unpacked sizes
```

The `./` matters — without it npm resolves `dist` as a package name on the registry. How
the two halves are staged, and why the Hermes side ships as TypeScript, is on
[Package map](/internals/packages/#how-eight-packages-become-one-tarball).

## The adversarial fixtures

`examples/` also holds files that attack the result channel on a real Hermes run and must
stay inert: `print-hijack`, `json-hijack`, `tojson-hijack`, `push-hijack`,
`iterator-hijack`, `robustness`, and `forge` (which prints a fabricated result frame and
must not be believed).

They are the regression suite for the threat model in
[the result protocol](/internals/result-protocol/). If you touch result emission, run all
of them — a green Node suite proves nothing here.

## Working on this site

The site is Astro + Starlight, in `website/` at the repository root. It sits **outside** the
pnpm workspace on purpose, so it never affects the runner's dependency graph — and it is
excluded from Biome, which cannot parse its Tailwind v4 CSS.

```bash
cd website
pnpm install --ignore-workspace
pnpm dev      # http://localhost:4321
pnpm build
```

Pages are Markdown or MDX in `src/content/docs/`. The sidebar is declared explicitly in
`astro.config.mjs`, so a new page means a new file **and** a new sidebar entry.

Every page has an "Edit page" link in its footer pointing at the file that produced it.

## Reporting a change

State the exact commands you ran and whether they passed. "Tests pass" without the commands
is not a report.
