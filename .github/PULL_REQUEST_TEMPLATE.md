# What and why

<!--
What changes, and what problem it solves. The diff already says what; this is
where the reasoning goes. Link an issue with "Closes #123" if there is one.
-->

# Gates

Paste what you actually ran and what it returned. "Should be fine" is not a
result. If you could not run something, say which and why — that is a normal
answer and more useful than silence.

```
pnpm typecheck            →
pnpm exec biome check .   →
pnpm test                 →
```

<!--
`pnpm exec biome check .` emits one known `info` about a biome.json migration.
Anything beyond that came from this branch.
-->

# Real Hermes

Vitest runs on Node. Argus ships code that runs on Hermes after going through
esbuild, and bugs live in that gap — lowering for the Hermes target has produced
code that passed every Node test and behaved differently on the real VM.

- [ ] This change cannot affect bundled Hermes behaviour, so no fixture run was
      needed.
- [ ] I ran the fixtures on real Hermes. Commands and results:

```
pnpm argus "examples/**/*.test.ts"    →
```

<!--
Some fixtures are supposed to fail: math-failing.test.ts proves stack remapping
works, forge.test.ts exits 2, and the hijack fixtures prove a hostile test
cannot forge a passing result. Check the exit code you expected, not just that
something ran. A user-facing change to bundled behaviour needs a fixture.
-->

# Architecture

- [ ] `@arguslab/core` is still pure: no `node:*`, no adapters, no I/O.
- [ ] Files touched are still around or below ~500 lines.
- [ ] If in-Hermes code changed, it stays inside the Hermes syntax envelope.
- [ ] If `packages/framework/src/index.ts` changed, the result channel still
      captures primordials before user code, frames output with the private
      nonce, and serialises by hand. Say below what changed and why.

<!--
The result channel is a high-integrity boundary: a defect there can make a
failing suite report as passing. Changes to it get read closely, which is a
property of the file rather than of you.
-->

# Anything a reviewer should know

<!--
Decisions you were unsure about, alternatives you rejected, follow-up work you
deliberately left out. Naming a known gap is better than having it found.
-->
