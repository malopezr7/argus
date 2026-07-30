import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { HermesSyntaxPolicy } from '../packages/adapter-esbuild/src/syntax-policy.js';
import { hermesSyntaxPolicy } from '../packages/adapter-esbuild/src/syntax-policy.js';
import type { HermesEngine } from '../packages/core/src/domain/hermes-version.js';
import { parseHermesVersionOutput } from '../packages/core/src/domain/hermes-version.js';

/**
 * The syntax policy, checked against the engines instead of against itself.
 *
 * `hermesSyntaxPolicy` decides what esbuild is allowed to leave in a bundle,
 * and it is wrong in two directions: hand legacy syntax it cannot parse and the
 * file dies before a test runs; downlevel syntax V1 reads natively and the
 * tests stop exercising the code the user wrote. Every entry in that map was
 * originally derived by spawning real binaries — via `tools/probe-hermes.mjs`,
 * deleted in 3aced1a — and after that deletion the only thing guarding it was a
 * unit test asserting the map against literals copied from the same file. Such
 * a test cannot fail for the reason that matters: the engine disagreeing.
 *
 * That is not hypothetical. The project's own handoff notes carried two
 * hand-written claims about this exact envelope that the binaries contradict —
 * that legacy rejects async functions (it runs them; only the ARROW form is
 * rejected) and that V1 "handles all of it" (it rejects async generators
 * exactly as legacy does). Prose drifts. This test is the thing that cannot.
 *
 * It is a HOST INTEGRATION test, so it lives beside `integration.test.ts` and
 * follows its convention: gated on the binary being present, skipped silently
 * when it is not. It imports the policy by relative path because the repo root
 * declares no dependency on the workspace packages.
 *
 * Binaries are discovered, never assumed:
 *   legacy  .hermes/hermes (gitignored), or $ARGUS_HERMES
 *   V1      ~/.argus/cache/hermes-*​/build/bin/hermes, or $ARGUS_HERMES_V1
 * The ENGINE of each is read from its own `HBC bytecode version`, not from
 * where it was found — 96 is legacy, 98 is V1 — so a binary in an unexpected
 * place is still measured against the right half of the policy.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 96 = legacy, 98 = Hermes V1. The reliable discriminator (releaseVersion is not). */
const BYTECODE_ENGINE: Record<number, HermesEngine> = { 96: 'legacy', 98: 'v1' };

interface Candidate {
  label: string;
  path: string;
}

/** Every V1 build the provisioner may have cached, newest paths last. */
function cachedV1Binaries(): string[] {
  const cacheRoot = join(homedir(), '.argus', 'cache');
  if (!existsSync(cacheRoot)) return [];
  try {
    return readdirSync(cacheRoot)
      .filter((name) => name.startsWith('hermes-'))
      .map((name) => join(cacheRoot, name, 'build', 'bin', 'hermes'))
      .filter((p) => existsSync(p));
  } catch {
    return [];
  }
}

function discoverBinaries(): Candidate[] {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const add = (label: string, path: string): void => {
    if (path.length > 0 && existsSync(path) && !seen.has(path)) {
      seen.add(path);
      found.push({ label, path });
    }
  };

  add('repo .hermes/hermes', resolve(REPO, '.hermes/hermes'));
  add('$ARGUS_HERMES', process.env.ARGUS_HERMES ?? '');
  add('$ARGUS_HERMES_V1', process.env.ARGUS_HERMES_V1 ?? '');
  for (const p of cachedV1Binaries()) add('~/.argus cache', p);

  return found;
}

const scratch = mkdtempSync(join(tmpdir(), 'argus-syntax-probe-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

let probeSeq = 0;

/**
 * Does this binary accept `source`?
 *
 * Each probe runs in its OWN process, from its own file: a parse error for one
 * form must not mask another, and a rejected form aborts the whole script.
 * "Accepted" means exit 0 AND the script actually reached its `print` — a
 * binary that exits 0 having produced nothing has not demonstrated support.
 */
function accepts(bin: string, source: string): boolean {
  probeSeq += 1;
  const file = join(scratch, `probe-${probeSeq}.js`);
  writeFileSync(file, `${source}\n`, 'utf8');
  const r = spawnSync(bin, [file], { encoding: 'utf8', timeout: 20_000 });
  return r.status === 0 && (r.stdout ?? '').includes('OK');
}

/**
 * One probe per claim the policy makes. Every one ends in `print("OK")` on the
 * success path, so support is proven by execution rather than by silence.
 */
const PROBES = {
  classDecl: 'class A { m() { return 1 } } print("OK:" + new A().m())',
  classFields:
    'class A { x = 1; #y = 2; y() { return this.#y } } print("OK:" + (new A().x + new A().y()))',
  classStaticBlock: 'class A { static v; static { A.v = 1 } } print("OK:" + A.v)',
  asyncFunction: 'async function f() { return 1 } f().then(function (v) { print("OK:" + v) })',
  asyncArrow: 'const f = async () => 1; f().then(function (v) { print("OK:" + v) })',
  asyncGenerator: 'async function* g() { yield 1 } print("OK")',
  optionalChaining: 'const o = { a: { b: 1 } }; print("OK:" + o?.a?.b)',
  nullish: 'print("OK:" + (null ?? 1))',
  logicalAssign: 'let a = null; a ??= 1; print("OK:" + a)',
  bigint: 'print("OK:" + typeof 1n)',
} as const;

type ProbeName = keyof typeof PROBES;
type ProbeResults = Record<ProbeName, boolean>;

function runProbes(bin: string): ProbeResults {
  const out = {} as ProbeResults;
  for (const name of Object.keys(PROBES) as ProbeName[]) {
    out[name] = accepts(bin, PROBES[name]);
  }
  return out;
}

/** The engine a binary reports itself to be, or undefined if it cannot say. */
function engineOf(bin: string): HermesEngine | undefined {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  const info = parseHermesVersionOutput(r.stdout ?? '');
  return info.bytecodeVersion === undefined ? undefined : BYTECODE_ENGINE[info.bytecodeVersion];
}

/** Whether the policy forces esbuild to downlevel `feature`. */
function lowers(policy: HermesSyntaxPolicy, feature: string): boolean {
  return policy.supported[feature] === false;
}

const BINARIES = discoverBinaries();

// One suite per binary present. Absent binaries produce no suite at all, which
// is how this stays green on a fresh clone — same contract as integration.test.ts.
describe.skipIf(BINARIES.length === 0)('hermesSyntaxPolicy vs the real engines', () => {
  for (const { label, path } of BINARIES) {
    const engine = engineOf(path);

    describe.skipIf(engine === undefined)(`${label} → ${engine ?? 'unrecognised'}`, () => {
      // Non-null: the suite is skipped when the engine is unknown.
      const policy = hermesSyntaxPolicy(engine as HermesEngine);
      const probes = runProbes(path);

      it('lowers classes exactly when the engine cannot parse one', () => {
        // Both directions matter. Lowering a class V1 reads natively replaces
        // the user's code with Babel's rewrite of it; NOT lowering one legacy
        // rejects kills the file with "invalid statement encountered".
        expect(policy.lowerClasses).toBe(!probes.classDecl);
      });

      it('lowers async generators exactly when the engine rejects them', () => {
        // The claim that V1 is a superset of legacy fails right here: both
        // engines reject `async function*`, so both must lower it.
        expect(lowers(policy, 'async-generator')).toBe(!probes.asyncGenerator);
      });

      it('lowers async exactly when the engine rejects the async ARROW form', () => {
        // esbuild has one lever (`async-await`) for a form the engines split
        // on, so the arrow — the stricter case — is what the policy must track.
        expect(lowers(policy, 'async-await')).toBe(!probes.asyncArrow);
      });

      it('keeps the async asymmetry that makes wholesale lowering the right trade', () => {
        // The claim prose keeps getting backwards: an engine that rejects async
        // ARROWS still runs async FUNCTIONS. Because esbuild cannot lower only
        // the arrow, async is lowered wholesale rather than rewriting every
        // arrow in the user's code. If this ever inverts, that reasoning — and
        // the comment in syntax-policy.ts stating it — is no longer true.
        if (!probes.asyncArrow) expect(probes.asyncFunction).toBe(true);
      });

      it('declares a target the engine parses whole', () => {
        // Everything at or below the declared floor must survive un-lowered,
        // or the target is set higher than the engine can read.
        expect(probes.optionalChaining).toBe(true);
        expect(probes.nullish).toBe(true);
        expect(probes.logicalAssign).toBe(true);
        expect(probes.bigint).toBe(true);
        expect(policy.target.length).toBeGreaterThan(0);
      });

      it('only leaves class syntax un-lowered on an engine that reads all of it', () => {
        // `lowerClasses: false` sends class fields, #private and static blocks
        // to the VM verbatim, so each has to be independently proven — legacy
        // rejects the three with three DIFFERENT errors, not one.
        if (!policy.lowerClasses) {
          expect(probes.classFields).toBe(true);
          expect(probes.classStaticBlock).toBe(true);
        }
      });
    });
  }
});
