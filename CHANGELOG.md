# Changelog

Notable changes to `@arguslab/argus`. Dates are release dates; entries under
Unreleased are on `main` but not published to npm.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
Argus follows [semantic versioning](https://semver.org/spec/v2.0.0.html) — with
the pre-1.0 caveat that a minor may change behaviour, which is why the entries
below say plainly which ones do.

## [Unreleased]

Nothing yet.

## [0.2.1] — 2026-08-03

The engine-selection and syntax fixes below change which Hermes build your tests
run on and how your source reaches it. If you are on React Native 0.82 or 0.83,
expect your tests to move from Hermes V1 to legacy — that is the correction, not
a regression: it is the engine your app actually ships.

### Fixed

- **Tests ran on the wrong engine.** When a React Native release pinned both
  Hermes builds, Argus always chose V1. React Native 0.82 and 0.83 pin both but
  ship legacy — V1 was opt-in and experimental there, and only became the
  default in 0.84. Every result on those two releases came from an engine the
  app does not run, which is the one thing Argus exists to get right. Selection
  now follows the release's own default, and an unrecognised React Native
  version says out loud which engine it assumed.

- **`class` syntax died on the legacy engine.** Class lowering only rewrote
  dependencies, never your own test files, and the engine target was hardcoded
  regardless of which engine was selected — so a `class` in a test reached
  legacy Hermes as native syntax and killed the file with
  `Invalid expression encountered`. The target is now derived from the resolved
  engine, and lowering covers the whole bundle on legacy while leaving V1
  untouched, since lowering there would change the code under test.

- **Your `tsconfig.json` was ignored when compiling for the legacy engine**, so
  `experimentalDecorators` and `useDefineForClassFields` took effect on V1 and
  not on legacy. A single ordinary method decorator failed the entire file on
  one engine and passed on the other. Discovery now mirrors esbuild's own
  resolution exactly — including `jsconfig.json`, `extends` through package
  presets, and files carrying a byte-order mark.

- **A control character in a test name discarded the whole file's results.** The
  result serializer escaped only five of the 32 C0 characters, so an ESC in a
  name produced a malformed envelope and every result in that file was thrown
  away, passing ones included.

- **Query results were snapshots, not live views.** A node held across a
  re-render kept serving the previous tree, so pressing a retained button twice
  ran the first render's handler twice. `within()` had the same problem. Nodes
  now read through to the current tree, and one removed from the tree reports
  itself detached rather than silently serving stale content.

- **A component teardown that threw hung the run.** An unmount that raised left
  the render registered as already gone, and cleanup spun forever, so the file
  died on the per-file timeout and discarded every result in it — including the
  tests that had already passed.

- **Queries over wide lists were quadratic.** A list of 5000 siblings went from
  passing to exceeding the timeout, which is an infrastructure failure rather
  than a test failure.

- **The Linux binaries would not start on most long-term-support
  distributions.** They were built against glibc 2.38 and now require 2.34, so
  they run on Ubuntu 22.04 LTS, Debian 12, Amazon Linux 2023 and RHEL 9. musl
  distributions such as Alpine are still out of reach. CI now fails the build if
  the requirement rises again — it could not catch this before, because it built
  and ran the binary on the same machine.

- **`argus.config.ts` failed in a CommonJS project**, which is what `npm init -y`
  creates: Node read it as CommonJS and rejected its `import` statement, while
  suggesting `.mjs` and never mentioning `.mts`. It is now retried as an ES
  module. Configs written in CommonJS syntax keep working unchanged.

- **An absolute path in a glob never matched**, and any pattern escaping the
  project root skipped exclusions entirely.

- **Published types omitted `expect.extend`, `expect.assertions` and
  `expect.hasAssertions`**, all three of which the runtime implements, so
  calling them was a type error against the installed package.

- **`argus --version` did not exist**, and asking for it — or mistyping any flag
  — was reported as an `INFRASTRUCTURE FAILURE`, the same banner used when the
  Hermes binary is missing. A typo now reads as one, and exits 2.

- The whole report was written to both stdout and stderr, so anything capturing
  both saw it twice.

### Changed

- The documentation says what Argus does. Several pages described the old
  engine-selection rule that was removed precisely because it broke fidelity;
  the quickstart imported a file it never created and failed on the first
  command; three documents each gave a different account of which releases carry
  provenance; and prebuilt availability was described as universal when it
  covers React Native 0.86 and 0.87 today. There is now a matrix of what is
  actually downloadable.

- The security fixtures test security. Five of them accepted *any* non-zero exit,
  so they passed with no Hermes binary present at all; the nonce-forgery fixture
  referenced a global nothing defines and died before forging anything; and the
  `print` hijack forwarded the authentic result frame unchanged, so it could not
  detect its own regression. All of them now fail if the defence they cover is
  removed.

- CI runs the component fixtures, which were documented as a gate but never
  executed, and fails if any fixture in `examples/` has no asserted exit code.
  It also installs the packed tarball into a scratch project on every pull
  request — previously that only happened at publish time, so a change that
  broke installation was discovered while trying to release.

### Removed

- The duplicate `run-phase1` pipeline and the ports and adapters that only it
  used. The integration suite drove that script rather than the CLI, so it
  validated 86 lines nobody runs instead of the 210 lines every user does — a
  regression in the real entry point could pass it untouched.

## [0.2.0] — 2026-07-29

### Added

- **Configuration file.** `argus.config.ts` and five other locations, loaded
  through Node's own type stripping, so a TypeScript config needs no transpiler
  and Argus gains no dependency for it. Options: `include`, `exclude`, `root`,
  `timeout`, `concurrency`, and a `hermes` block taking `path`, `engine` and
  `provision`. Precedence runs defaults, `package.json`, config file,
  environment, then flags.

### Changed

- **Discovery now excludes `dist`, `build` and `coverage` by default.** Anything
  matching the globs used to run, anywhere, so a test file emitted by a build
  was discovered and executed.
- **`--timeout` rejects a value it cannot parse.** `--timeout abc` used to be
  accepted and silently run with 10000.

### Fixed

- `node_modules` was matched as a substring rather than a path segment, so a
  directory named e.g. `my-node_modules-fixtures` was silently skipped.

## [0.1.1] — 2026-07-29

The first release published from CI, and so the first whose origin can be
verified. See [SECURITY.md](SECURITY.md) for the command.

### Fixed

- The prebuilt archive reader accepts GNU tar archives. It only ever read the
  POSIX ustar layout Argus itself writes.

## [0.1.0] — 2026-07-29

First release. Runs React Native unit tests on the standalone Hermes VM: each
test file is bundled and executed in its own Hermes process, with no device, no
Metro and no emulator.

Published by hand, before the release workflow existed, so it carries no
provenance attestation.

[Unreleased]: https://github.com/malopezr7/argus/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/malopezr7/argus/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/malopezr7/argus/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/malopezr7/argus/releases/tag/v0.1.0
