import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The name on npm. Also the marker that proves a manifest is ours. */
export const PUBLISHED_NAME = '@arguslab/argus';

/**
 * Where the published version lives, in each of the two layouts Argus runs in.
 *
 *   development (tsx, from source)     installed (npm)
 *   ───────────────────────────────    ─────────────────────
 *   packages/cli/src/version.ts        <pkg>/bin/argus.js
 *   packaging/package.json             <pkg>/package.json
 *
 * There is exactly ONE version in the repo — `packaging/package.json` — and the
 * build copies that file verbatim to become the installed `package.json`. So
 * these two candidates are not two sources of truth to keep in step; they are
 * one file, read at the two paths it occupies. `argus --version` from source
 * and from an install cannot disagree, and there is no constant anywhere for a
 * release to forget to bump.
 *
 * Anchored to this module's own location, never the working directory — the
 * same rule as `paths.ts`, for the same reason: installed, the CWD is the
 * consumer's project, where a `package.json` is guaranteed to exist and
 * guaranteed to be the wrong one.
 */
export const MANIFEST_CANDIDATES: readonly (readonly string[])[] = [
  // Installed: this module is bundled into <pkg>/bin/argus.js.
  ['..', 'package.json'],
  // Development: this module is packages/cli/src/version.ts, run through tsx.
  ['..', '..', '..', 'packaging', 'package.json'],
];

/**
 * Read the version out of the first candidate manifest that is actually ours.
 *
 * Pure apart from the injected reader, so both layouts are testable without
 * building a package or staging a fake install.
 *
 * A manifest is only accepted when it names THIS package. Installed under a
 * consumer's tree the first candidate may well resolve to some other
 * `package.json`, and reporting their version as Argus's is a worse answer than
 * no answer at all.
 */
export function selectPackageVersion(
  moduleDir: string,
  read: (path: string) => string | undefined,
): string | undefined {
  for (const segments of MANIFEST_CANDIDATES) {
    const raw = read(join(moduleDir, ...segments));
    if (raw === undefined) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A manifest that will not parse is not a manifest. Keep looking.
      continue;
    }

    const manifest = parsed as { name?: unknown; version?: unknown };
    if (manifest.name !== PUBLISHED_NAME) continue;
    if (typeof manifest.version !== 'string' || manifest.version === '') continue;
    return manifest.version;
  }
  return undefined;
}

/** Message for a package that cannot find its own manifest — a broken install. */
export function missingManifestMessage(moduleDir: string): string {
  return [
    `Argus could not determine its own version: no ${PUBLISHED_NAME} manifest was found.`,
    'This means the installation is incomplete — try reinstalling Argus.',
    'Looked for:',
    ...MANIFEST_CANDIDATES.map((segments) => `  ${join(moduleDir, ...segments)}`),
  ].join('\n');
}

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The published version of this Argus.
 *
 * Throws rather than reporting "unknown". A version string is an identity, and
 * a wrong or vague one costs more than a loud failure: it is the first thing
 * quoted in a bug report, and a package that cannot find its own manifest has a
 * problem worth surfacing on its own.
 */
export function resolvePackageVersion(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const version = selectPackageVersion(moduleDir, readIfPresent);
  if (version === undefined) throw new Error(missingManifestMessage(moduleDir));
  return version;
}
