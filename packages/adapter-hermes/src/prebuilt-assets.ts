/**
 * The HTTP and integrity boundary for prebuilt Hermes downloads.
 *
 * Separated from the adapter so the network is one injectable function: every
 * adapter test drives a stub and none of them can reach the internet, which is
 * the only way a test suite stays honest about offline behaviour.
 */

import { createHash } from 'node:crypto';

/**
 * Outcome of asking for one release asset.
 *
 * `not-found` is split out from `error` because the two mean opposite things to
 * the provisioning chain: a 404 says this platform or version was never
 * published, which is an ordinary fact the chain moves past, whereas a broken
 * transport is worth reporting even though it also cannot supply a binary.
 */
export type AssetResponse =
  | { kind: 'ok'; bytes: Buffer }
  | { kind: 'not-found' }
  | { kind: 'error'; reason: string };

/** Fetches one URL. Injected so no test needs a network. */
export type AssetFetcher = (url: string) => Promise<AssetResponse>;

/** Wall-clock cap so a stalled download cannot hang a test run indefinitely. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * The real fetcher, on Node's global `fetch`.
 *
 * Proxies are supported exactly as far as the runtime supports them for free:
 * Node honours `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` for `fetch` when
 * started with `--use-env-proxy` or `NODE_USE_ENV_PROXY=1`. Argus does not ship
 * its own proxy stack — that would mean vendoring an HTTP agent, and the whole
 * download path exists precisely because this package has no dependencies.
 */
export const fetchAssetOverHttps: AssetFetcher = async (url) => {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (response.status === 404) return { kind: 'not-found' };
    if (!response.ok) {
      return { kind: 'error', reason: `HTTP ${response.status} ${response.statusText}` };
    }

    return { kind: 'ok', bytes: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    return { kind: 'error', reason: error instanceof Error ? error.message : String(error) };
  }
};

/** Hex SHA-256 of a buffer. */
export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A checksum line: `<64 hex>  <name>`, with shasum's optional binary marker. */
const CHECKSUM_LINE_RE = /^([0-9a-f]{64})\s+\*?(.+)$/;

/**
 * Read the digest for `assetName` out of a `shasum -a 256` style file.
 *
 * Matching on the name rather than taking the first line means the same parser
 * reads a per-asset file and the aggregate one, and that a checksum file listing
 * some other asset is a miss instead of the wrong answer.
 */
export function findChecksum(contents: string, assetName: string): string | undefined {
  for (const rawLine of contents.split('\n')) {
    const match = CHECKSUM_LINE_RE.exec(rawLine.trim());
    if (match !== null && match[2] === assetName) return match[1];
  }
  return undefined;
}

/** Raised when a download's contents do not match its published digest. */
export class ChecksumMismatchError extends Error {
  constructor(assetName: string, expected: string, actual: string) {
    super(
      `${assetName} failed its checksum: expected sha256 ${expected}, got ${actual}. ` +
        'The download is corrupt or the published asset has been altered — ' +
        'Argus will not run a binary it cannot verify.',
    );
    this.name = 'ChecksumMismatchError';
  }
}

/** Throw unless `bytes` hashes to `expected`. */
export function verifyChecksum(assetName: string, bytes: Buffer, expected: string): void {
  const actual = sha256(bytes);
  if (actual !== expected) throw new ChecksumMismatchError(assetName, expected, actual);
}
