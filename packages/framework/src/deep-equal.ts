/**
 * @argus/framework — deep equality helpers
 *
 * Moved from matchers.ts (ADR-1). Runs IN-REALM alongside user test code.
 * Follows Hermes 0.17 envelope rules: index loops, no for..of/spread,
 * no Array.prototype methods, no WeakRef/WeakMap/WeakSet.
 *
 * HERMES 0.17 ENVELOPE RULES (enforced here):
 *   - No async arrows / generators / await
 *   - No WeakRef / WeakMap / WeakSet (cycle tracking uses parallel index arrays)
 *   - No for..of / spread in deepEqual (immune to iterator pollution)
 *   - No Array.prototype methods in deepEqual (use index loops + .length)
 *   - No Intl APIs
 *   Allowed: Object.is, Object.keys, Array.isArray, instanceof, Object.prototype.
 *            hasOwnProperty.call, Object.getOwnPropertyDescriptor, String/Number ops,
 *            RegExp.prototype.test, try/catch, constructor reads.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SameValueZero: +0 ≡ -0, NaN ≡ NaN (R7). */
export function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || Object.is(a, b);
}

export function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

export function effectiveKeys(obj: Record<string, unknown>, strict: boolean): string[] {
  const raw = Object.keys(obj);
  if (strict) return raw;
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (obj[raw[i]] !== undefined) out[out.length] = raw[i];
  }
  return out;
}

export function sameType(a: object, b: object): boolean {
  return (
    (a as { constructor?: unknown }).constructor === (b as { constructor?: unknown }).constructor
  );
}

// ---------------------------------------------------------------------------
// deepEqual — single recursive engine (ADR-3, R2, R4)
// ---------------------------------------------------------------------------

export function deepEqual(
  a: unknown,
  b: unknown,
  strict: boolean,
  seenA: unknown[] = [],
  seenB: unknown[] = [],
): boolean {
  // 1. Object.is leaf (NaN===NaN, +0≠-0)
  if (Object.is(a, b)) return true;

  // 2. Both must be non-null objects
  const aObj = a !== null && typeof a === 'object';
  const bObj = b !== null && typeof b === 'object';
  if (!aObj || !bObj) return false;

  // 3. Two-sided cycle check (R2 — bisimulation guard, AC-42)
  for (let i = 0; i < seenA.length; i++) {
    if (seenA[i] === a || seenB[i] === b) {
      return seenA[i] === a && seenB[i] === b;
    }
  }

  // 4. Date — use === so two invalid Dates (NaN) are NOT equal (R4, AC-40)
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getTime() === b.getTime();
  }

  // 5. RegExp
  if (a instanceof RegExp || b instanceof RegExp) {
    if (!(a instanceof RegExp) || !(b instanceof RegExp)) return false;
    return a.source === b.source && a.flags === b.flags;
  }

  // 6. Map/Set loud guard (ADR-4, REQ-01b, AC-36)
  if (a instanceof Map || b instanceof Map || a instanceof Set || b instanceof Set) {
    throw new Error(
      'deepEqual: Map/Set structural equality is not supported in this build. ' +
        'Compare via Array.from(...) or assert on specific entries.',
    );
  }

  // 7. Array
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr) return false;
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    seenA[seenA.length] = a;
    seenB[seenB.length] = b;
    let ok = true;
    for (let i = 0; i < arrA.length; i++) {
      const inA = i in arrA;
      const inB = i in arrB;
      if (strict && inA !== inB) {
        ok = false;
        break;
      }
      if (!deepEqual(arrA[i], arrB[i], strict, seenA, seenB)) {
        ok = false;
        break;
      }
    }
    seenA.length = seenA.length - 1;
    seenB.length = seenB.length - 1;
    return ok;
  }

  // 8. Strict type-tag gate (ADR-4)
  if (strict && !sameType(a as object, b as object)) return false;

  // 9. Plain object key comparison
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = effectiveKeys(objA, strict);
  const keysB = effectiveKeys(objB, strict);
  if (keysA.length !== keysB.length) return false;

  seenA[seenA.length] = a;
  seenB[seenB.length] = b;
  let ok = true;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (!hasOwn(objB, k)) {
      ok = false;
      break;
    }
    if (!deepEqual(objA[k], objB[k], strict, seenA, seenB)) {
      ok = false;
      break;
    }
  }
  seenA.length = seenA.length - 1;
  seenB.length = seenB.length - 1;
  return ok;
}

// ---------------------------------------------------------------------------
// matchObject — cycle-safe subset matching for toMatchObject (R3)
// ---------------------------------------------------------------------------

export function matchObject(
  actual: unknown,
  subset: unknown,
  seenA: unknown[] = [],
  seenB: unknown[] = [],
): boolean {
  if (actual === null || typeof actual !== 'object') return false;
  if (subset === null || typeof subset !== 'object') return false;

  // Map/Set loud guard (REQ-01b, AC-36) — applied at EVERY recursion level so a
  // nested Map/Set value cannot slip past as a key-less plain object (which would
  // silently match). Mirrors deepEqual's guard; covers either side.
  if (
    actual instanceof Map ||
    actual instanceof Set ||
    subset instanceof Map ||
    subset instanceof Set
  ) {
    throw new Error(
      'deepEqual: Map/Set structural equality is not supported in this build. ' +
        'Compare via Array.from(...) or assert on specific entries.',
    );
  }

  // Cycle guard — if we've visited this exact (actual, subset) pair, treat as matched
  for (let i = 0; i < seenA.length; i++) {
    if (seenA[i] === actual && seenB[i] === subset) return true;
  }

  const subObj = subset as Record<string, unknown>;
  const actObj = actual as Record<string, unknown>;
  const keys = Object.keys(subObj);

  seenA[seenA.length] = actual;
  seenB[seenB.length] = subset;
  let ok = true;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!hasOwn(actObj, k)) {
      ok = false;
      break;
    }
    const sv = subObj[k];
    const av = actObj[k];
    // Recurse with matchObject for nested plain objects; deepEqual for leaves/arrays
    if (
      sv !== null &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      !(sv instanceof Date) &&
      !(sv instanceof RegExp)
    ) {
      if (!matchObject(av, sv, seenA, seenB)) {
        ok = false;
        break;
      }
    } else {
      if (!deepEqual(av, sv, false, seenA, seenB)) {
        ok = false;
        break;
      }
    }
  }
  seenA.length = seenA.length - 1;
  seenB.length = seenB.length - 1;
  return ok;
}

// ---------------------------------------------------------------------------
// getByPath — path resolution for toHaveProperty (R6)
// ---------------------------------------------------------------------------

export function getByPath(
  obj: unknown,
  keyPath: string | Array<string | number>,
): { found: boolean; value: unknown } {
  const segments: Array<string | number> =
    typeof keyPath === 'string' ? keyPath.split('.') : keyPath;

  let cur: unknown = obj;
  for (let i = 0; i < segments.length; i++) {
    if (cur === null || typeof cur !== 'object') return { found: false, value: undefined };
    const key = String(segments[i]);
    if (!hasOwn(cur as object, key)) return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[key];
  }
  return { found: true, value: cur };
}
