/**
 * Canonical Argus snapshot serializer.
 *
 * This is intentionally a documented subset rather than a pretty-format clone.
 * Every supported value has one representation; everything else fails loudly.
 */

interface HostNodeLike {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly parent: HostNodeLike | null;
  readonly children: Array<HostNodeLike | string>;
}

const arrayIsArray = Array.isArray;
const objectKeys = Object.keys;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const objectPrototype = Object.prototype;
const numberIsNaN = Number.isNaN;
const positiveInfinity = Number.POSITIVE_INFINITY;
const negativeInfinity = Number.NEGATIVE_INFINITY;
const numberToString = Number.prototype.toString;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringIndexOf = String.prototype.indexOf;
const stringSlice = String.prototype.slice;
const mapConstructor = Map;
const mapForEach = Map.prototype.forEach;
const setConstructor = Set;
const setForEach = Set.prototype.forEach;

function unsupported(path: string, detail: string): never {
  throw new Error(`Unsupported snapshot value at ${path}: ${detail}`);
}

function indent(depth: number): string {
  let out = '';
  for (let i = 0; i < depth; i++) out += '  ';
  return out;
}

function hex4(code: number): string {
  const raw = numberToString.call(code, 16);
  return stringSlice.call(`0000${raw}`, -4);
}

function quoteString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = stringCharCodeAt.call(value, i);
    if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x09) out += '\\t';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0d) out += '\\r';
    else if (code < 0x20 || code === 0x2028 || code === 0x2029) {
      out += `\\u${hex4(code)}`;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? stringCharCodeAt.call(value, i + 1) : -1;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1];
        i++;
      } else {
        out += `\\u${hex4(code)}`;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += `\\u${hex4(code)}`;
    } else {
      out += value[i];
    }
  }
  return `${out}"`;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Sort without depending on engine-specific Array#sort details. */
function insertionSort<T>(values: T[], keyOf: (value: T) => string): void {
  for (let i = 1; i < values.length; i++) {
    const value = values[i];
    const key = keyOf(value);
    let j = i - 1;
    while (j >= 0 && compareCodeUnits(keyOf(values[j]), key) > 0) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = value;
  }
}

function canonicalNumber(value: number): string {
  if (numberIsNaN(value)) return 'NaN';
  if (value === positiveInfinity) return 'Infinity';
  if (value === negativeInfinity) return '-Infinity';
  if (objectIs(value, -0)) return '-0';

  const raw = numberToString.call(value);
  const e = stringIndexOf.call(raw, 'e');
  if (e < 0) return raw;

  const mantissa = stringSlice.call(raw, 0, e);
  let exponent = stringSlice.call(raw, e + 1);
  let sign = '';
  if (exponent[0] === '+' || exponent[0] === '-') {
    if (exponent[0] === '-') sign = '-';
    exponent = stringSlice.call(exponent, 1);
  }
  while (exponent.length > 1 && exponent[0] === '0') {
    exponent = stringSlice.call(exponent, 1);
  }
  return `${mantissa}e${sign}${exponent}`;
}

function seenIndex(seen: unknown[], value: unknown): number {
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] === value) return i;
  }
  return -1;
}

function hasOwnSymbols(value: object): boolean {
  return objectGetOwnPropertySymbols(value).length > 0;
}

function isHostNode(value: object): value is HostNodeLike {
  try {
    const candidate = value as Partial<HostNodeLike>;
    return (
      typeof candidate.type === 'string' &&
      candidate.props !== null &&
      typeof candidate.props === 'object' &&
      arrayIsArray(candidate.children) &&
      'parent' in candidate
    );
  } catch {
    return false;
  }
}

function renderArray(value: unknown[], depth: number, seen: unknown[], path: string): string {
  if (objectKeys(value).length !== value.length) {
    return unsupported(path, 'arrays must be dense and have no enumerable named properties');
  }
  if (hasOwnSymbols(value)) return unsupported(path, 'symbol-keyed properties are not supported');
  if (value.length === 0) return '[]';

  let out = '[\n';
  for (let i = 0; i < value.length; i++) {
    const descriptor = objectGetOwnPropertyDescriptor(value, numberToString.call(i));
    if (descriptor === undefined || !('value' in descriptor)) {
      return unsupported(`${path}[${i}]`, 'array holes and accessors are not supported');
    }
    out += `${indent(depth + 1)}${render(descriptor.value, depth + 1, seen, `${path}[${i}]`)},\n`;
  }
  return `${out}${indent(depth)}]`;
}

function renderObject(
  value: Record<string, unknown>,
  depth: number,
  seen: unknown[],
  path: string,
): string {
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) {
    return unsupported(path, 'only plain objects and null-prototype objects are supported');
  }
  if (hasOwnSymbols(value)) return unsupported(path, 'symbol-keyed properties are not supported');

  const keys = objectKeys(value);
  insertionSort(keys, (key) => key);
  if (keys.length === 0) return '{}';

  let out = '{\n';
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      return unsupported(`${path}.${key}`, 'accessor properties are not supported');
    }
    out += `${indent(depth + 1)}${quoteString(key)}: ${render(
      descriptor.value,
      depth + 1,
      seen,
      `${path}.${key}`,
    )},\n`;
  }
  return `${out}${indent(depth)}}`;
}

interface RenderedMapEntry {
  key: string;
  value: string;
  order: string;
}

function renderMap(
  value: Map<unknown, unknown>,
  depth: number,
  seen: unknown[],
  path: string,
): string {
  const entries: RenderedMapEntry[] = [];
  mapForEach.call(value, function collect(entryValue: unknown, entryKey: unknown): void {
    const key = render(entryKey, depth + 1, seen, `${path}.<key>`);
    const renderedValue = render(entryValue, depth + 1, seen, `${path}.<value>`);
    entries[entries.length] = { key, value: renderedValue, order: `${key}\u0000${renderedValue}` };
  });
  insertionSort(entries, (entry) => entry.order);
  if (entries.length === 0) return 'Map {}';

  let out = 'Map {\n';
  for (let i = 0; i < entries.length; i++) {
    out += `${indent(depth + 1)}${entries[i].key} => ${entries[i].value},\n`;
  }
  return `${out}${indent(depth)}}`;
}

function renderSet(value: Set<unknown>, depth: number, seen: unknown[], path: string): string {
  const entries: string[] = [];
  setForEach.call(value, function collect(entryValue: unknown): void {
    entries[entries.length] = render(entryValue, depth + 1, seen, `${path}.<value>`);
  });
  insertionSort(entries, (entry) => entry);
  if (entries.length === 0) return 'Set {}';

  let out = 'Set {\n';
  for (let i = 0; i < entries.length; i++) {
    out += `${indent(depth + 1)}${entries[i]},\n`;
  }
  return `${out}${indent(depth)}}`;
}

function validHostType(type: string): boolean {
  if (type.length === 0) return true;
  const first = stringCharCodeAt.call(type, 0);
  if (!((first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a))) return false;
  for (let i = 1; i < type.length; i++) {
    const code = stringCharCodeAt.call(type, i);
    const letter = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    const digit = code >= 0x30 && code <= 0x39;
    if (!letter && !digit && code !== 0x2e && code !== 0x3a && code !== 0x5f && code !== 0x2d) {
      return false;
    }
  }
  return true;
}

function renderHostProp(value: unknown, depth: number, seen: unknown[], path: string): string {
  if (typeof value === 'string') return quoteString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return `{${render(value, depth, seen, path)}}`;
  }
  const rendered = render(value, depth + 1, seen, path);
  if (stringIndexOf.call(rendered, '\n') < 0) return `{${rendered}}`;
  return `{\n${rendered}\n${indent(depth)}}`;
}

function renderHostNode(node: HostNodeLike, depth: number, seen: unknown[], path: string): string {
  if (!validHostType(node.type))
    return unsupported(path, `invalid HostNode type ${quoteString(node.type)}`);
  if (hasOwnSymbols(node.props)) {
    return unsupported(`${path}.props`, 'symbol-keyed properties are not supported');
  }

  if (node.type === '') {
    let root = '';
    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) root += '\n';
      const child = node.children[i];
      root +=
        typeof child === 'string'
          ? indent(depth) + quoteString(child)
          : renderHostNode(child, depth, seen, `${path}.children[${i}]`);
    }
    return root;
  }

  const keys = objectKeys(node.props);
  insertionSort(keys, (key) => key);
  let out = `${indent(depth)}<${node.type}`;
  let propCount = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === 'children') continue;
    const descriptor = objectGetOwnPropertyDescriptor(node.props, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      return unsupported(`${path}.props.${key}`, 'accessor properties are not supported');
    }
    if (propCount === 0) out += '\n';
    out += `${indent(depth + 1)}${key}=${renderHostProp(
      descriptor.value,
      depth + 1,
      seen,
      `${path}.props.${key}`,
    )}\n`;
    propCount++;
  }
  if (propCount > 0) out += indent(depth);

  if (node.children.length === 0) return `${out}/>`;
  out += '>\n';
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    out +=
      typeof child === 'string'
        ? `${indent(depth + 1)}${quoteString(child)}`
        : renderHostNode(child, depth + 1, seen, `${path}.children[${i}]`);
    out += '\n';
  }
  return `${out}${indent(depth)}</${node.type}>`;
}

function render(value: unknown, depth: number, seen: unknown[], path: string): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;
  if (type === 'string') return quoteString(value as string);
  if (type === 'number') return canonicalNumber(value as number);
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'bigint' || type === 'symbol' || type === 'function') {
    return unsupported(path, `${type} is not supported`);
  }

  if (seenIndex(seen, value) >= 0) return unsupported(path, 'cycles are not supported');
  seen[seen.length] = value;
  try {
    if (arrayIsArray(value)) return renderArray(value, depth, seen, path);
    if (value instanceof mapConstructor) return renderMap(value, depth, seen, path);
    if (value instanceof setConstructor) return renderSet(value, depth, seen, path);
    if (isHostNode(value as object)) {
      return renderHostNode(value as HostNodeLike, depth, seen, path);
    }
    return renderObject(value as Record<string, unknown>, depth, seen, path);
  } finally {
    seen.length = seen.length - 1;
  }
}

export function serializeSnapshot(value: unknown): string {
  return render(value, 0, [], '$');
}
