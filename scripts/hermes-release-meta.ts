/**
 * Surfaces the release identity for a Hermes tag, so the workflow consumes
 * variables instead of templating strings in YAML:
 *
 *   pnpm exec tsx scripts/hermes-release-meta.ts \
 *     --tag hermes-v250829098.0.16 --notes-out notes.md
 *
 * Every answer comes from `@arguslab/core` — the same module the provisioning
 * chain derives the download URL from, so the release a maintainer publishes
 * and the release a user fetches can never be named differently.
 *
 * Writes `release-tag`, `release-title` and `asset-count` to `GITHUB_OUTPUT`
 * when it is set, and the release body to `--notes-out`.
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  HERMES_BIN_PLATFORMS,
  hermesReleaseNotes,
  hermesReleaseTag,
  hermesReleaseVersion,
  parseHermesTag,
} from '../packages/core/src/index.js';
import { fail, log, pass } from './lib/exec.js';

function main(): void {
  const { values } = parseArgs({
    options: { tag: { type: 'string' }, 'notes-out': { type: 'string' } },
  });

  const tag = values.tag;
  if (tag === undefined) fail('usage: hermes-release-meta --tag <tag> [--notes-out <file>]');

  const ref = parseHermesTag(tag);
  if (ref === undefined) fail(`unparsable Hermes ref: ${tag}`);

  const version = hermesReleaseVersion(tag);
  const releaseTag = hermesReleaseTag(tag);
  if (version === undefined || releaseTag === undefined) {
    fail(
      `${tag} cannot name a release version — date-based refs and bare commit ` +
        'SHAs are not publishable under this scheme',
    );
  }

  const title = `Hermes ${ref.engine === 'v1' ? 'V1' : 'legacy'} ${version} prebuilt binaries`;

  const notesOut = values['notes-out'];
  if (notesOut !== undefined) {
    writeFileSync(notesOut, hermesReleaseNotes({ tag, engine: ref.engine, version }));
    pass(`release notes written to ${notesOut}`);
  }

  const output = process.env.GITHUB_OUTPUT;
  if (output !== undefined && output !== '') {
    appendFileSync(
      output,
      `release-tag=${releaseTag}\nrelease-title=${title}\nasset-count=${HERMES_BIN_PLATFORMS.length}\n`,
    );
  }

  log(`release tag:   ${releaseTag}`);
  log(`release title: ${title}`);
  log(`assets:        ${HERMES_BIN_PLATFORMS.length}`);
}

main();
