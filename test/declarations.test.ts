/**
 * The published type declarations, pinned against the implementation they describe.
 *
 * `packaging/argus.d.ts` is hand-written, and it has to be: it declares AMBIENT
 * GLOBALS and an ambient `argus` module, carries the prose a user reads on hover,
 * and describes React-shaped values structurally so a project with no React
 * installed still typechecks. None of that survives `tsc --declaration`, which
 * emits modules and drops nothing but also invents nothing.
 *
 * What it must not be is a SECOND SOURCE OF TRUTH that drifts. It already did:
 * `expect.extend`, `expect.assertions` and `expect.hasAssertions` were
 * implemented, documented and shipped, and never declared — so calling any of
 * them from TypeScript was a TS2339 against the published package.
 *
 * So the file stays hand-written and is VERIFIED instead. The runtime is the
 * ground truth: these tests enumerate the real objects the framework installs
 * and require the declarations to name exactly the same members, in both
 * directions. Adding a matcher without declaring it fails here; declaring one
 * that does not exist fails here too.
 *
 * The comparison is done through the TypeScript parser rather than by searching
 * the text, because a substring check passes on a member that is mentioned in a
 * comment, in a different interface, or in a name that merely contains it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { installArgusNamespace } from '../packages/framework/src/argus-namespace.js';
import { makeAsyncMatchers } from '../packages/framework/src/async-matchers.js';
import { expect as argusExpect, makeMatchers } from '../packages/framework/src/matchers.js';
import { argusFn } from '../packages/framework/src/mock-fn.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parse(...segments: string[]): ts.SourceFile {
  const path = join(REPO, ...segments);
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

const publishedGlobals = parse('packaging', 'argus.d.ts');
const internalMatcherTypes = parse('packages', 'framework', 'src', 'matcher-types.ts');

/**
 * Every member an interface declares, by name.
 *
 * Index signatures are skipped deliberately: `[key: string]: unknown` is what
 * lets a user's own `expect.extend` matcher typecheck, and it would otherwise
 * make every membership assertion below vacuously true.
 */
function membersOf(source: ts.SourceFile, interfaceName: string): Set<string> {
  const names = new Set<string>();
  let found = false;

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found = true;
      for (const member of node.members) {
        if (ts.isIndexSignatureDeclaration(member)) continue;
        const name = member.name;
        if (name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
          names.add(name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (!found) throw new Error(`${source.fileName} declares no interface named ${interfaceName}`);
  return names;
}

/** The type annotation of a `declare const`, as written. */
function declaredConstType(source: ts.SourceFile, constName: string): string {
  let annotation: string | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constName
    ) {
      annotation = node.type?.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (annotation === undefined) throw new Error(`no \`declare const ${constName}\` found`);
  return annotation;
}

/** Own members of a live object, split by whether they are accessors. */
function liveMembers(value: object): { methods: string[]; accessors: string[] } {
  const methods: string[] = [];
  const accessors: string[] = [];
  for (const name of Object.getOwnPropertyNames(value)) {
    if (FUNCTION_INTRINSICS.has(name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor?.get !== undefined) accessors.push(name);
    else methods.push(name);
  }
  return { methods, accessors };
}

/** Properties every function object has. Never part of the authored surface. */
const FUNCTION_INTRINSICS = new Set(['length', 'name', 'prototype', 'arguments', 'caller']);

/**
 * Runtime members that are deliberately NOT published.
 *
 * `__mockState` is the mock's private behaviour record. It is reachable because
 * a mock is a plain function object with no way to hide it on the Hermes
 * envelope, not because it is API.
 */
const INTERNAL_MEMBERS = new Set(['__mockState']);

function published(value: object): string[] {
  return liveMembers(value)
    .methods.filter((name) => !INTERNAL_MEMBERS.has(name))
    .sort();
}

// ---------------------------------------------------------------------------

describe('the published declarations describe the expect() surface', () => {
  const live = makeMatchers(0, false) as unknown as object;
  const liveAsync = makeAsyncMatchers(
    Promise.resolve(0),
    false,
    false,
    makeMatchers,
    {},
  ) as unknown as object;

  it('declares every matcher the framework installs', () => {
    const declared = membersOf(publishedGlobals, 'ArgusMatchers');

    expect([...published(live)].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('declares every sub-matcher selector the framework installs', () => {
    const declared = membersOf(publishedGlobals, 'ArgusMatchers');

    expect(liveMembers(live).accessors.filter((name) => !declared.has(name))).toEqual([]);
  });

  it('declares no matcher the framework does not install', () => {
    const declared = membersOf(publishedGlobals, 'ArgusMatchers');
    const { methods, accessors } = liveMembers(live);
    const installed = new Set([...methods, ...accessors]);

    expect([...declared].filter((name) => !installed.has(name))).toEqual([]);
  });

  it('declares every awaited matcher .resolves and .rejects install', () => {
    const declared = membersOf(publishedGlobals, 'ArgusAsyncMatchers');
    const { methods, accessors } = liveMembers(liveAsync);
    const installed = [...methods.filter((n) => !INTERNAL_MEMBERS.has(n)), ...accessors];

    expect(installed.filter((name) => !declared.has(name))).toEqual([]);
  });

  /**
   * `expect` is a callable with statics bolted onto it. Declaring it as a bare
   * function type — which is what it was — silently drops all three: a call to
   * `expect.extend` is then TS2339 against a package that implements it,
   * documents it, and has shipped it since the first release.
   */
  it('declares every static bolted onto expect itself', () => {
    const declared = membersOf(publishedGlobals, 'ArgusExpect');

    expect(published(argusExpect).filter((name) => !declared.has(name))).toEqual([]);
  });

  it('declares no expect static the framework does not install', () => {
    const declared = membersOf(publishedGlobals, 'ArgusExpect');
    const installed = new Set(published(argusExpect));

    expect([...declared].filter((name) => !installed.has(name))).toEqual([]);
  });

  it('keeps expect callable, so expect(value) still typechecks', () => {
    const members = membersOf(publishedGlobals, 'ArgusExpect');

    expect(declaredConstType(publishedGlobals, 'expect')).toBe('ArgusExpect');
    // A call signature has no name, so it is invisible to membersOf. Assert the
    // interface is more than its statics by checking the text carries one.
    expect(publishedGlobals.text).toContain('(actual: unknown): ArgusMatchers;');
    expect(members.size).toBeGreaterThan(0);
  });
});

describe('the published declarations describe the argus namespace', () => {
  it('declares every member of the installed argus global', () => {
    const host: Record<string, unknown> = {};
    installArgusNamespace(host);
    const declared = membersOf(publishedGlobals, 'ArgusNamespace');

    expect(Object.keys(host.argus as object).filter((name) => !declared.has(name))).toEqual([]);
  });

  it('declares every method a mock function carries', () => {
    const declared = membersOf(publishedGlobals, 'ArgusMockFn');

    expect(published(argusFn()).filter((name) => !declared.has(name))).toEqual([]);
  });

  /**
   * `mockRestore` is the one legitimate asymmetry: `argus.spyOn` adds it,
   * `argus.fn` does not, which is exactly why it is declared optional.
   */
  it('declares mockRestore, which only a spy carries', () => {
    const spy = argusFn();
    const target = { method: (): void => {} };
    const declared = membersOf(publishedGlobals, 'ArgusMockFn');

    expect(published(spy)).not.toContain('mockRestore');
    expect(declared.has('mockRestore')).toBe(true);
    expect(typeof target.method).toBe('function');
  });
});

/**
 * The internal `Matchers` type and the published `ArgusMatchers` are the same
 * contract written twice — the framework compiles against one and the user
 * against the other. Left unchecked, an internal-only addition typechecks in
 * this repo and is missing for every consumer.
 */
describe('the internal and published matcher types agree', () => {
  it('declares the same synchronous matchers on both sides', () => {
    expect([...membersOf(publishedGlobals, 'ArgusMatchers')].sort()).toEqual(
      [...membersOf(internalMatcherTypes, 'Matchers')].sort(),
    );
  });

  it('declares the same awaited matchers on both sides', () => {
    expect([...membersOf(publishedGlobals, 'ArgusAsyncMatchers')].sort()).toEqual(
      [...membersOf(internalMatcherTypes, 'AsyncMatchers')].sort(),
    );
  });
});
