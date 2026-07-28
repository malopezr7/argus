---
title: Contributing
description: How to get the repo running, the gates every change must pass, and the rules that are not negotiable.
sidebar:
  order: 3
---

Argus lives at [github.com/malopezr7/argus](https://github.com/malopezr7/argus). MIT
licensed.

## Getting set up

```bash
git clone https://github.com/malopezr7/argus.git
cd argus
pnpm install
```

**pnpm only.** Not npm, not npx, not yarn, not bun. The workspace uses the `workspace:*`
protocol and the package manager version is pinned in `package.json`.

You also need a Hermes binary to run the fixtures. Either vendor one at `.hermes/hermes`
(gitignored) or let the runner provision it.

## The gates

Every change runs all four. No exceptions, and no "done" claimed without them.

```bash
pnpm typecheck              # tsc across the workspace
pnpm exec biome check .     # lint + format
pnpm test                   # vitest, host-side
pnpm argus "examples/**/*.test.ts"   # real Hermes
```

That last one is not optional, and it is the one people skip.

### Why a green Node suite is not enough

The bug that motivated this rule: esbuild lowers a loop-scoped `const` to `var` for the
Hermes target, so a closure created in the loop captures the last iteration's value. A
matcher-wrapping loop made every wrapped matcher call the same method.

Every Node unit test passed. It only failed on a real Hermes run, because **the bug does
not exist until the bundle is lowered**, and Node never sees the lowered bundle.

Any change to bundling, the framework, matchers or the runner needs a real
`pnpm argus …` run. New user-facing features that affect bundled Hermes behaviour need at
least one fixture in `examples/`.

## The fixtures

`examples/` holds files meant to run through `pnpm argus`, **not** through Vitest.

| Fixture | Expected |
|---|---|
| `math.test.ts`, `matchers.test.ts`, `jest-api.test.ts`, `rn-mocks.test.ts`, `component-api.test.tsx` | exit 0 |
| `math-failing.test.ts`, `component-query-failing.test.tsx` | exit 1 — and the stack must point at the source |
| `forge.test.ts` | exit 2 — a fabricated result frame must not be accepted |
| `robustness`, `print-hijack`, `json-hijack`, `tojson-hijack`, `push-hijack`, `iterator-hijack` | must stay inert |

The adversarial set is the regression suite for the threat model in
[the result protocol](/internals/result-protocol/). If you touch result emission, run all
of them.

## Non-negotiable rules

- **Keep `@argus/core` pure.** No adapter imports, no runtime imports, not even
  `node:path`. Paths are segments.
- **The result channel is sacred.** In `packages/framework/src/index.ts`: captured
  primordials, the private nonce, the hand-written serializer. No `JSON.stringify`, no
  array methods, no iterators, no prototype-sensitive APIs. Index loops only.
- **Respect the syntax envelope** for anything bundled into Hermes. Host-side code is
  ordinary Node and has none of these constraints —
  [details](/hermes/syntax-envelope/).
- **Never run Hermes through stdin.** Stdin puts it in REPL mode. File mode only.
- **Files stay around or below ~500 lines.** Split when they grow past it.
- **Conventional Commits**, no AI attribution in commit messages.

## Where to start reading

1. `packages/core/src/domain/types.ts` — the domain model.
2. `packages/framework/src/index.ts` — before touching result emission.
3. `packages/cli/src/cli.ts` — the composition flow.
4. The current [roadmap](/reference/roadmap/) item, before adding surface area.

## A known trap

The unit-test harness **duplicates** the runner.
`packages/framework/__tests__/run-harness.ts` reimplements `runSuite` / `runTest` because
`index.ts` captures `print` at module evaluation and cannot be imported under Node.

Runner bugs therefore have to be fixed in **both** places, and the real runner is only
covered by the fixtures on Hermes. A green unit suite alone does not prove runner logic.
Extracting a shared runner module is on the list.

## Reporting a change

State the exact commands you ran and whether they passed. "Tests pass" without the commands
is not a report.
