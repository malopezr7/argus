---
title: Command and flags
description: Every flag argus accepts, what it defaults to, and what it rejects.
sidebar:
  order: 1
---

```text
argus [globs...]
```

Positional arguments are globs of test files to discover and run. With none, the defaults
are `**/*.test.ts` and `**/*.test.tsx`.

## Flags

| Flag | Short | Default | Purpose |
|---|---|---|---|
| `--timeout <ms>` | `-t` | `10000` | Per-file Hermes timeout |
| `--concurrency <n>` | `-c` | CPU count, capped at 8 | Max files in flight |
| `--config <path>` | | searched for | Config file to use, instead of searching |
| `--hermes <path>` | | — | Hermes binary to use, overrides `ARGUS_HERMES` |
| `--engine <name>` | | project's pin, preferring V1 | `legacy` or `v1` |
| `--provision` | | off | Authorise building Hermes from source |
| `--help` | `-h` | | Print usage and exit 0 |

## Environment

| Variable | Effect |
|---|---|
| `ARGUS_HERMES` | Hermes binary path. Overridden by `--hermes`. |
| `NO_COLOR` / `FORCE_COLOR` | Honoured — colour comes from Node's `util.styleText`. |

## `--timeout`

```bash
argus --timeout 30000 "src/**/*.test.ts"
```

Applies to the whole Hermes process for one file, not to individual tests. Exceeding it
kills the process and reports the file as `timeout`, exit code 2.

There is no per-test timeout. The unit of isolation is the file, so the unit of timeout is
too.

Only a strict positive integer is accepted, the same rule `--concurrency` has always had:

```text
✗ Usage error: Invalid --timeout value: "abc". Must be a positive integer (e.g. 5000, 30000).
```

Before 0.1.1 an unparseable value was silently replaced by the 10 000 ms default, so a typo
produced a full green run under a timeout nobody chose.

## `--concurrency`

```bash
argus -c 1 "src/**/*.test.ts"    # sequential — useful when debugging
argus -c 16 "src/**/*.test.ts"
```

Defaults to `availableParallelism()` clamped to 8. Each unit is a full process, so pushing
it far past your core count buys nothing.

Only a strict positive integer is accepted. `0`, negatives, `1.5`, `1e2` and `2abc` are all
rejected with a usage error and exit code 2 — a silently coerced concurrency is a
performance mystery waiting to happen.

## `--engine`

```bash
argus --engine v1 "src/**/*.test.ts"
argus --engine legacy "src/**/*.test.ts"
```

Only `legacy` and `v1` are accepted. A typo is rejected, never ignored — silently falling
back to the default would run the tests on an engine you did not ask for, which is the
exact failure this flag exists to prevent.

Asking for an engine your project does not pin is a usage error:

```text
--engine legacy is not available: react-native 0.87.0 pins only: v1.
```

## `--hermes`

```bash
argus --hermes /opt/hermes/bin/hermes "src/**/*.test.ts"
```

Outranks everything, and is **not probed** before selection: naming a path entitles you to
an error about that path rather than a silent fallback onto another binary.

If it turns out to be a different engine than your project targets, you get
[the mismatch warning](/hermes/engines/#the-mismatch-warning) — a warning, not a refusal.

## `--provision`

```bash
argus --provision "src/**/*.test.ts"
```

Authorises a source build when nothing else in the chain can supply a binary. Needs `git`,
`cmake` and `ninja`. Never happens without this flag — a multi-minute build is not
something to trigger by accident.

## Globs

Quote them. Unquoted globs are expanded by your shell before Argus sees them, which usually
works and occasionally does something surprising with `**`.

```bash
argus "src/**/*.test.ts"                       # ✓
argus "src/**/*.test.ts" "lib/**/*.test.tsx"   # ✓ several
argus src/cart.test.ts                         # ✓ a literal path
```

Positional globs override the config file's `include` entirely. `node_modules`, `dist`,
`build`, `coverage` and `.git` are excluded from discovery by default — see
[`exclude`](/cli/configuration/#exclude) to change that.

Report order follows discovery order even though execution is parallel, so output is stable
run to run.

A run that matches **zero** files exits 2. There is no `passWithNoTests` yet — it is on the
[roadmap](/reference/roadmap/).

## `--config`

```bash
argus --config config/ci.config.ts
```

Names a config file instead of searching for one. A path that does not exist is an error,
not a fall back to the defaults.

Without it, Argus searches upward from the working directory for `argus.config.ts`,
`.mts`, `.js`, `.mjs`, `.config/argus.config.ts`, then a `package.json` field — first hit
wins, and the walk stops at the first `package.json`.

Everything a config file can set, and which source wins when two disagree:
[Configuration](/cli/configuration/).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Every test passed |
| `1` | At least one test failed |
| `2` | Something else went wrong — infra failure, timeout, protocol failure, usage error, or zero files matched |

Details: [Reporting and exit codes](/cli/reporting/).
