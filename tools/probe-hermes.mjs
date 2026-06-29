/**
 * Probe a standalone Hermes binary for the JS syntax/features it supports, so
 * the esbuild syntax policy (target + `supported` overrides) can be derived
 * empirically per Hermes version instead of guessed.
 *
 * Each feature runs in its OWN process: a parse error for one syntax form must
 * not mask the others. A feature is "supported" only if the probe prints OK.
 *
 * Usage: node tools/probe-hermes.mjs [path-to-hermes]   (default: .hermes/hermes)
 */
import { spawnSync } from 'node:child_process';

const HERMES = process.argv[2] ?? '.hermes/hermes';

/** Each probe must print `OK:<anything>` to stdout iff the feature works. */
const PROBES = [
  ['async function decl', "async function f(){return 1} f().then(()=>print('OK'))"],
  ['async arrow', "const f=async()=>1; f().then(()=>print('OK'))"],
  ['async generator', "async function* g(){yield 1} print('OK')"],
  ['generator', "function* g(){yield 1} print('OK:'+g().next().value)"],
  ['optional chaining ?.', "const o={a:{b:1}}; print('OK:'+o?.a?.b)"],
  ['nullish ??', "print('OK:'+(null??1))"],
  ['logical assign ??=', "let a=null; a??=1; print('OK:'+a)"],
  ['BigInt', "print('OK:'+typeof 1n)"],
  ['Proxy', "print('OK:'+new Proxy({},{get:()=>1}).x)"],
  ['WeakRef', "if(typeof WeakRef!=='undefined')print('OK')"],
  ['FinalizationRegistry', "if(typeof FinalizationRegistry!=='undefined')print('OK')"],
  ['Intl', "if(typeof Intl!=='undefined')print('OK')"],
  ['microtask drain', "Promise.resolve().then(()=>print('OK'))"],
];

function supported(js) {
  const r = spawnSync(HERMES, ['/dev/stdin'], { input: `${js}\n`, encoding: 'utf8' });
  return r.status === 0 && /(^|\n)OK\b/.test(r.stdout ?? '');
}

const ver = spawnSync(HERMES, ['--version'], { encoding: 'utf8' }).stdout ?? '';
console.log(`# Hermes syntax probe — ${HERMES}`);
console.log(
  ver
    .split('\n')
    .find((l) => /release version/i.test(l))
    ?.trim() ?? '(version unknown)',
);
console.log('');
const policy = { supported: [], unsupported: [] };
for (const [name, js] of PROBES) {
  const ok = supported(js);
  policy[ok ? 'supported' : 'unsupported'].push(name);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
}
console.log('');
console.log(`supported:   ${policy.supported.join(', ')}`);
console.log(`unsupported: ${policy.unsupported.join(', ')}`);
console.log('');
console.log('esbuild policy hint: lower any unsupported syntax via `supported`,');
console.log(
  'e.g. async arrow/generator unsupported -> { "async-await": false, "async-generator": false }.',
);
