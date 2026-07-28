# Contributing to Argus

Thanks for looking at this. Argus is small and pre-1.0, which means a good
change is easy to land and a wrong abstraction is expensive to remove later —
so the bar is on reasoning, not ceremony.

Read [SECURITY.md](SECURITY.md) before reporting anything that looks like a
vulnerability. It does not belong in a public issue.

## Getting set up

You need **Node 24 or newer** and **pnpm**. CI runs Node 24.

pnpm is pinned by the `packageManager` field in `package.json`, so let Corepack
honour it rather than installing a global pnpm:

```bash
corepack enable
pnpm install
```

Use `pnpm` for everything. Not `npm`, not `npx`, not `yarn`, not `bun` — the
lockfile and the workspace layout are pnpm's, and the others will produce a
tree that behaves differently from everyone else's.

## The Hermes binary

Argus needs a real Hermes VM to run tests on. **You do not have to build or
download one by hand** — it is provisioned automatically on first run, from the
first source that has one:

1. `--hermes <path>` or `ARGUS_HERMES=<path>`
2. `./.hermes/hermes` in the project
3. The build cache in `~/.argus/cache`
4. The legacy VM bundled with react-native 0.73–0.82
5. A prebuilt archive downloaded from this repository's releases
6. A source build, only if you passed `--provision`

Every run prints which one it used:

```
✓ hermes v1 hermes-v250829098.0.16 · prebuilt darwin-arm64 · /path/to/hermes
```

Include that line in bug reports. It identifies the engine, the version, and
how it got there, which is usually most of the diagnosis.

Building from source is the last resort and is opt-in:

```bash
pnpm argus --provision "examples/**/*.test.ts"
```

That needs `git`, `cmake` and `ninja` on your PATH, and it takes minutes rather
than seconds. There is no reason to reach for it unless you are working on the
build path itself or you are on a platform with no published prebuilt.

## The gates

Run all three before you push. They are exactly what CI runs:

```bash
pnpm typecheck            # tsc --noEmit across the workspace
pnpm exec biome check .   # lint + format
pnpm test                 # Vitest, on Node
```

`pnpm exec biome check .` currently emits one `info` about a `biome.json`
migration. That one is known. Anything else is yours.

### Vitest is not enough on its own

`pnpm test` runs on **Node**. Argus ships code that runs on **Hermes**, after
being put through esbuild. Bugs live in that gap, and they are not theoretical:
esbuild's lowering for the Hermes target has produced code that passes every
Node test and behaves differently on the real VM.

So there is a fourth gate whenever you touch anything that gets bundled — the
framework, the matchers, the runner, the syntax envelope:

```bash
pnpm argus "examples/**/*.test.ts"
pnpm argus "examples/**/*.test.tsx"
```

`examples/` holds Hermes fixtures. **They are run with `pnpm argus`, not
Vitest.** Some of them are supposed to fail: `examples/math-failing.test.ts`
exists to prove stack remapping works, and the hijack fixtures exist to prove a
hostile test file cannot forge a passing result. Check the exit code you
expected, not just that something ran.

A user-facing change that affects bundled Hermes behaviour needs at least one
real fixture exercising it.

## Architecture rules

These are load-bearing. A change that breaks one of them will be sent back even
if it works.

**`@argus/core` stays pure.** No `node:*` imports, no adapters, no I/O. It holds
domain types, ports, and pure functions. Everything that touches the world is an
adapter, and `@argus/cli` is the only composition root that wires them together.
If something in core needs the filesystem, the design is wrong, not core.

**The result channel is a high-integrity boundary.** `packages/framework/src/index.ts`
captures primordials before user code runs, frames its output with a private
nonce, and serialises by hand — no `JSON.stringify`, no array methods, no
iterators. That is not stylistic. Test files can pollute prototypes and override
globals, and the channel has to survive it. Do not casually refactor it.

**In-Hermes code lives inside a syntax envelope.** The Hermes builds Argus
targets do not parse everything Node does. In the runner, deep-equality and
serializer paths, prefer index loops over `for..of`, spread and
`Array.prototype` methods — the point is immunity to prototype and iterator
pollution, not performance.

**Keep files around or below ~500 lines.** When a module outgrows that, split it
along a real seam rather than at an arbitrary line.

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(framework): add toHaveBeenCalledTimes matcher
fix(sourcemap): keep remapStacks total when a frame has no mapping
refactor(cli): split provisioning chain out of cli.ts
```

Allowed types: `feat`, `fix`, `refactor`, `build`, `ci`, `chore`, `docs`,
`style`, `perf`, `test`.

For pull requests:

- One concern per PR. A refactor bundled with a behaviour change is two PRs.
- Say which gates you ran and what they returned. "Should be fine" is not a
  result. If you could not run something, say which and why.
- If you touched bundled code, say which fixtures you ran on real Hermes.
- Explain *why*, not just what. The diff already says what.

The PR template asks for these; it is a checklist, not paperwork.

## Where to start reading

In this order, it takes about an hour to get oriented:

1. `packages/core/src/domain/types.ts` — the domain model.
2. `packages/cli/src/cli.ts` — how a run is actually composed.
3. `packages/framework/src/index.ts` — the runner and the result channel.
4. `packages/adapter-esbuild/src/` — how a test file becomes a sealed bundle.

The README has the architecture diagram and the package map.

## Licence

By contributing you agree your contributions are licensed under the
[MIT Licence](LICENSE), the same as the rest of the project.
