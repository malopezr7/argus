# Security Policy

## Project status

Argus is pre-1.0 and pre-release. Every package sits at `0.0.0`, nothing is
published to npm, and the public interfaces are still moving. Treat it as
software you evaluate, not software you depend on in a release pipeline yet.

That status affects what this policy can honestly promise, so it is stated
first rather than buried.

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Anything else | No |

There are no releases to backport to. Fixes land on `main`, and the fix is the
supported version. If a versioned release line ever exists, this table changes
with it.

Prebuilt Hermes binaries are versioned separately, by the **Hermes** version
they were built from rather than by Argus. They are covered by this policy.

## Reporting a vulnerability

**Report privately through GitHub, not in a public issue.**

Use [private vulnerability reporting][advisory-new], which is enabled on this
repository. It opens a draft security advisory visible only to you and the
maintainer, and it is the correct channel because it lets a fix and a
disclosure be prepared at the same time.

Do not open a public issue, and do not post details in a pull request or
discussion. Email is not the reporting channel; the advisory form keeps the
report attached to the repository it concerns.

A useful report includes:

- What an attacker gains, concretely.
- The steps to reproduce, ideally as a test file or a minimal repository.
- The Argus commit, your Node version, and your OS and architecture.
- The provisioning summary line Argus prints on every run, if the report
  touches Hermes provisioning:
  `✓ hermes v1 hermes-v250829098.0.16 · prebuilt darwin-arm64 · /path`

## What to expect

This is maintained by one person, so the commitment is deliberately modest and
meant to be kept:

| Stage | Target |
| --- | --- |
| Acknowledgement that the report was read | 5 business days |
| An assessment: accepted, needs more detail, or out of scope | 10 business days |
| Fix for an accepted report | Discussed in the advisory, driven by severity |

If a report goes unacknowledged past those windows, it is an oversight rather
than a decision — escalate by commenting on the advisory.

Credit is given in the advisory unless you would rather stay anonymous.

## What counts as a vulnerability here

Argus runs test files you wrote, on a JavaScript VM, on your machine. It is not
a sandbox and does not claim to be one. A test file that reads your filesystem
is a test file doing what test files do.

What Argus *does* claim, and what is therefore in scope:

**A test must not be able to forge its own verdict.** The channel carrying
results out of Hermes is deliberately hardened: the framework captures
primordials before user code runs, each bundle gets a private nonce, the host
accepts exactly one framed line carrying that nonce, and the payload is written
by a hand-rolled serializer that avoids `JSON.stringify`, array methods and
iterators. Anything that makes a failing suite report as passing — prototype
pollution, global override, a forged frame, a smuggled nonce — is a
vulnerability, not a curiosity. See `packages/framework/src/index.ts`.

**A binary Argus downloads must be the one this repository built.** Argus
fetches prebuilt Hermes archives at run time and then executes them. Anything
that gets different bytes onto disk and past the checksum check is in scope.

**The build pipeline must not be steerable from outside.** The workflow in
`.github/workflows/hermes-prebuilt.yml` compiles binaries that users download
and run. Anything letting an unprivileged actor influence what it produces —
injection into a workflow expression, an unpinned or hijackable action, a
permission wider than the job needs — is in scope.

Out of scope: a test file affecting the machine it runs on, engine bugs in
upstream Hermes (report those to [facebook/hermes][hermes]), and vulnerabilities
in dependencies with no path to exploitation through Argus.

## Verifying a Hermes binary you downloaded

Argus verifies checksums automatically before it trusts an archive. If you are
downloading one by hand, or auditing what a machine already fetched, there are
two separate checks and they answer different questions.

### Integrity — did it arrive intact?

Every release ships a `.sha256` beside each archive and a `checksums.txt`
covering all of them:

```bash
shasum -a 256 -c checksums.txt
```

### Origin — who built it?

A checksum cannot answer this. Whoever replaces an archive replaces the
`.sha256` next to it, and both look correct. Origin needs a signature that does
not travel with the file.

Release archives carry a signed [build provenance attestation][provenance],
recorded in a public transparency log:

```bash
gh attestation verify hermes-250829098.0.16-darwin-arm64.tar.gz --repo malopezr7/argus
```

This succeeds only for bytes produced by this repository's `hermes-prebuilt`
workflow, and reports the workflow and commit that produced them. An archive
from anywhere else fails, which is the entire point.

All four archives in `hermes-bin-v250829098.0.16` — `darwin-arm64`, `darwin-x64`,
`linux-x64` and `linux-arm64` — carry an attestation and verify.

> **Reading the output.** `gh attestation verify` prints nothing on success in
> some versions; the exit code is the signal. `echo $?` after it, and expect
> `0`. A tampered or foreign archive exits non-zero with an HTTP 404 — no
> attestation is recorded for those bytes under this repository.

## How the supply chain is protected

For a project that compiles and distributes executables, the pipeline is part
of the attack surface. What is in place:

- Every GitHub Action is pinned to a full commit SHA, not a floating tag. A tag
  can be repointed by whoever controls the action's repository; a SHA cannot.
- Every workflow declares explicit least-privilege `permissions`. `contents:
  write` and the attestation signing permissions exist only on the publish job.
- The job token is not persisted into `.git/config`, so build scripts and CMake
  cannot read a repository credential off disk.
- Publishing runs in a protected GitHub Environment behind a required reviewer.
- `main` is protected: no force-push, no deletion, changes arrive by pull
  request with CI green.
- Secret scanning with push protection, Dependabot alerts, and automated
  security fixes are enabled.
- Every Hermes build is gated on bytecode parity with the official
  `hermes-compiler` package React Native ships. A build that emits different
  bytecode for the same source never reaches a release.

[advisory-new]: https://github.com/malopezr7/argus/security/advisories/new
[provenance]: https://docs.github.com/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds
[hermes]: https://github.com/facebook/hermes
