/**
 * @argus/framework — bounded, cycle-safe value renderer
 *
 * Moved from matchers.ts (ADR-1, ADR-5, R5). Runs IN-REALM alongside user
 * test code. Uses Object.getOwnPropertyDescriptor to read object keys so
 * accessor side-effects are never triggered (R5, AC-41).
 *
 * Follows Hermes 0.17 envelope rules: index loops, no for..of/spread,
 * no Array.prototype methods.
 */

// ---------------------------------------------------------------------------
// show() — bounded, cycle-safe renderer (ADR-5, R5)
// ---------------------------------------------------------------------------

const MAX_DEPTH = 4;
const MAX_ENTRIES = 8;
const MAX_STRING = 80;

export function show(value: unknown): string {
  return render(value, 0, []);
}

function render(v: unknown, depth: number, seen: unknown[]): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';

  const t = typeof v;
  if (t === 'string') return quote(v as string);
  if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (t === 'boolean' || t === 'bigint') return String(v);
  if (t === 'function') return '[Function]';
  if (t === 'symbol') return '[Symbol]';

  // Objects
  if (v instanceof Date) return `[Date ${(v as Date).getTime()}]`;
  if (v instanceof RegExp) return `/${(v as RegExp).source}/${(v as RegExp).flags}`;
  if (v instanceof Map) return '[Map]';
  if (v instanceof Set) return '[Set]';

  // Cycle check
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] === v) return '[Circular]';
  }

  if (Array.isArray(v)) {
    if (depth >= MAX_DEPTH) return '[Array]';
    seen[seen.length] = v;
    const arr = v as unknown[];
    let out = '[';
    const n = arr.length < MAX_ENTRIES ? arr.length : MAX_ENTRIES;
    for (let i = 0; i < n; i++) {
      if (i > 0) out += ', ';
      // R5/AC-41: read indices via descriptor so accessor indices are never
      // invoked. Holes (no descriptor) render as `undefined`; accessors as
      // `[Getter]`; data indices render their value.
      const desc = Object.getOwnPropertyDescriptor(arr, String(i));
      out +=
        desc === undefined
          ? 'undefined'
          : 'value' in desc
            ? render(desc.value as unknown, depth + 1, seen)
            : '[Getter]';
    }
    if (arr.length > MAX_ENTRIES) out += ', …';
    out += ']';
    seen.length = seen.length - 1;
    return out;
  }

  // Plain object
  if (depth >= MAX_DEPTH) return '[Object]';
  seen[seen.length] = v;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj);
  let out = '{ ';
  const n = keys.length < MAX_ENTRIES ? keys.length : MAX_ENTRIES;
  for (let i = 0; i < n; i++) {
    if (i > 0) out += ', ';
    const key = keys[i];
    // R5: use getOwnPropertyDescriptor — never invoke accessors (AC-41)
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    const valStr =
      desc !== undefined && 'value' in desc
        ? render(desc.value as unknown, depth + 1, seen)
        : '[Getter]';
    out += `${renderKey(key)}: ${valStr}`;
  }
  if (keys.length > MAX_ENTRIES) out += ', …';
  out += ' }';
  seen.length = seen.length - 1;
  return out;
}

function quote(s: string): string {
  const body = s.length > MAX_STRING ? s.substring(0, MAX_STRING) : s;
  let out = '"';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else out += c;
  }
  return s.length > MAX_STRING ? `${out}…"` : `${out}"`;
}

function renderKey(k: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : quote(k);
}
