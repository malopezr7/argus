# Security Policy

## Project status

Argus is pre-1.0. One package is published to npm — `@arguslab/argus` — and the
public interfaces are still moving. Treat it as software you evaluate, not
software you depend on in a release pipeline yet.

That status affects what this policy can honestly promise, so it is stated
first rather than buried.

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | Yes |
| The latest npm release | Yes |
| Anything older | No |

Pre-1.0 there is no backport line. Fixes land on `main` and ship in the next
release; the fix is the supported version. If a maintained release line ever
exists, this table changes with it.

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

**The build pipeline must not be steerable from outside.** Two workflows
produce artifacts that users execute: `.github/workflows/hermes-prebuilt.yml`
compiles the Hermes binaries, and `.github/workflows/npm-publish.yml` builds and
publishes the npm package. Anything letting an unprivileged actor influence what
either produces — injection into a workflow expression, an unpinned or
hijackable action, a permission wider than the job needs — is in scope.

Out of scope: a test file affecting the machine it runs on, engine bugs in
upstream Hermes (report those to [facebook/hermes][hermes]), and vulnerabilities
in dependencies with no path to exploitation through Argus.

## Verifying the npm package

### Which versions can be verified

| Version | Provenance |
| --- | --- |
| `0.1.0` | **No** — published by hand from a laptop, before the release workflow existed |
| Every release after it | Yes — published by `.github/workflows/npm-publish.yml` |

**`0.1.0` is currently the only version on the registry, and it cannot be
verified.** It carries the registry's own signature, which says npm served those
bytes; it carries no attestation, so there is nothing that proves *where they
came from*. The commands below return `{"error":"Not found"}` against it. That
is the honest answer rather than a bug — do not read it as evidence of
tampering, and do not read it as verification either.

The next release is the first one these commands will work against. They are
written below against `0.2.0` so they can be copied and edited; substitute
whichever version you are actually checking.

### Origin — who built it?

Releases published by the workflow carry a [provenance
attestation][npm-provenance]: a Sigstore-signed statement, recorded in a public
transparency log, binding that exact tarball to this repository, the workflow
that built it, and the commit it was built from.

Three steps: fetch the bytes the registry serves, fetch the attestation npm
recorded for them, and check one against the other.

```bash
# 1. the exact tarball the registry serves
npm pack @arguslab/argus@0.2.0

# 2. the signed provenance npm recorded for it
curl -sS https://registry.npmjs.org/-/npm/v1/attestations/@arguslab/argus@0.2.0 \
  | jq '.attestations[] | select(.predicateType == "https://slsa.dev/provenance/v1") | .bundle' \
  > provenance.json

# 3. check the tarball against the attestation
gh attestation verify arguslab-argus-0.2.0.tgz \
  --bundle provenance.json \
  --repo malopezr7/argus \
  --digest-alg sha512
```

`--digest-alg sha512` is not optional. npm records the subject digest as SHA-512
while `gh` defaults to SHA-256, and without the flag the digests never match and
verification fails for a reason that has nothing to do with the package.

A version published without provenance returns `{"error":"Not found"}` at step 2
and leaves an empty `provenance.json` — there is nothing to verify, which is a
different answer from "verification failed".

> **Reading the output.** `gh attestation verify` prints nothing on success in
> some versions; the exit code is the signal. `echo $?` after it, and expect
> `0`. A tarball this repository did not publish exits non-zero.

### Why not `npm audit signatures`

`npm audit signatures` checks the whole dependency tree and reports totals. It
does not single out a package that simply has no attestation: with `0.1.0`
installed it reports verified signatures and verified attestations, zero
invalid, zero missing — and never mentions that Argus itself is in none of those
groups. It is a useful tree-wide check and a misleading per-package one, so it
is not the command to reach for here.

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
- **There is no npm token in this repository.** The package is published through
  npm [trusted publishing][npm-trusted]: the workflow proves its identity to npm
  over OIDC and receives a short-lived credential. There is no long-lived secret
  to leak, rotate, or steal from a compromised runner.
- The job that publishes to npm performs no checkout and installs no
  dependencies. It runs no third-party code at all, which is why it is the one
  job allowed to hold a credential that speaks for the repository.
- A release is anchored to a tag: the workflow refuses to publish unless a
  `v<version>` tag exists and points at the exact commit being built.
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
[npm-provenance]: https://docs.npmjs.com/generating-provenance-statements
[npm-trusted]: https://docs.npmjs.com/trusted-publishers
[hermes]: https://github.com/facebook/hermes
