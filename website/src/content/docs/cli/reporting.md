---
title: Reporting and exit codes
description: How output is split across stdout and stderr, what each outcome means, and why a failing test is not a broken runner.
sidebar:
  order: 3
---

## Output

```text
✓ hermes v1 hermes-v250829098.0.16 · prebuilt darwin-arm64 · ~/.argus/cache/…/bin/hermes

Cart
  ✓ starts empty
  ✓ adds an item
  ✗ applies a discount  — expected 450 but received 500
    at src/cart.test.ts:24:28
  ✎ handles refunds
  ○ flaky on CI

3 passed, 1 failed, 1 todo, 5 total (52 ms in Hermes)

  ✓ money.test.ts
  ✗ cart.test.ts (test failure)
    ✗ applies a discount  — expected 450 but received 500
      at src/cart.test.ts:24:28

2 files: 1 passed, 1 failed
9 tests: 7 passed, 1 failed, 1 todo
```

| Glyph | Status |
|---|---|
| `✓` | passed |
| `✗` | failed |
| `✎` | todo |
| `○` | skipped |

The duration is time **inside Hermes**, not wall-clock for the whole run. Bundling,
provisioning and process spawn are excluded, so the number tells you about your code rather
than about your machine's disk.

## stdout and stderr

Passing output and the summary go to **stdout**. Failures and diagnostics go to **stderr**.

That split is not cosmetic — it lets you pipe a run's report somewhere machine-readable
while failures still land where a human or a CI annotator looks for them.

Your own `console.log` output is captured per file and printed under a `[user logs]`
heading rather than interleaved with the report, so a chatty test cannot make the results
unreadable.

## Outcomes

Each file produces exactly one outcome. The distinction that matters: **a failing test is
not a broken runner.**

| Outcome | Meaning | Exit |
|---|---|---|
| `passed` | Every test in the file passed | 0 |
| `failed` | The suite ran; some tests failed | 1 |
| `timeout` | The Hermes process outlived `--timeout` | 2 |
| `infrastructure-failure` | Bundling, provisioning or spawning broke | 2 |
| `protocol-failure` | No valid result frame came back | 2 |

Conflating "your assertion was wrong" (1) with "the runner could not run" (2) is how CI
pipelines end up green on a broken toolchain. Argus keeps them apart everywhere: in the
outcome type, in the exit code, and in the wording.

### `infrastructure-failure`

```text
✗ INFRASTRUCTURE FAILURE [bundle] Could not resolve "./missing"
```

The stage is named in brackets — `provision`, `bundle`, `spawn`, `discover`. Something
before or around your test broke; your tests never ran, or never finished.

### `protocol-failure`

```text
✗ PROTOCOL FAILURE [no-frame]
--- raw stdout ---
<everything the process printed>
```

The Hermes process exited without producing exactly one valid result frame. Raw stdout is
dumped in full, because when the protocol breaks the only useful thing left is everything.

A non-zero Hermes exit is an infrastructure failure **even if a frame was printed earlier**
— a process that crashed after reporting did not really report.

## Session exit code

The worst case across every file: `2` beats `1` beats `0`.

A session with **zero** files exits 2. Matching nothing is far more often a wrong glob than
a genuinely empty suite, and exiting 0 on it turns a typo into a green build.

## In CI

The provisioning line is one line by design so it survives in a log. It is worth reading in
CI specifically — it is the difference between "our tests pass on Hermes V1, the engine we
ship" and "our tests pass on whatever binary happened to be on the runner".

```yaml
- run: pnpm exec argus "src/**/*.test.ts"
```

No flags needed for CI. Argus never prompts, never opens an interactive picker, and never
waits on input — a prompt in CI is a hang.

## Reporters

Output is terminal-only today. Pluggable reporters — JSON and JUnit for CI consumption —
are on the [roadmap](/reference/roadmap/) for v0.3.0.
