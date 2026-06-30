/**
 * show() bounding tests — task 5.2 + 5.2b
 * AC-25..28, AC-41, ADR-5, R5
 */
import { describe, expect, it } from 'vitest';
import { show } from '../src/matchers.js';

describe('show() renderer', () => {
  // --- Depth cap (AC-25) ---

  it('depth-5 object hits [Object] placeholder at cap (AC-25)', () => {
    const value = { a: { b: { c: { d: { e: 1 } } } } };
    const out = show(value);
    expect(out).toContain('[Object]');
    // Should not recurse to e: 1
    expect(out).not.toContain('e: 1');
  });

  it('depth exactly 4 (MAX_DEPTH) nested objects: leaf at depth 4 renders as [Object] (AC-25)', () => {
    // MAX_DEPTH=4, depth>=4 → [Object]. Object at depth 4 triggers the cap.
    const value = { a: { b: { c: { d: { e: 1 } } } } };
    const out = show(value);
    // At depth 4 we hit the cap, so 'd' value renders as [Object]
    expect(out).toContain('[Object]');
  });

  it('depth 3 object renders fully', () => {
    const value = { a: { b: { c: 42 } } };
    const out = show(value);
    expect(out).toContain('42');
  });

  // --- Array element cap (AC-26) ---

  it('10-element array truncates at 8 and appends … (AC-26)', () => {
    const value = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = show(value);
    expect(out).toContain('…');
    expect(out).toContain('8');
    expect(out).not.toContain('9');
  });

  it('8-element array shows all elements without truncation', () => {
    const value = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = show(value);
    expect(out).not.toContain('…');
    expect(out).toContain('8');
  });

  // --- String truncation (AC-27) ---

  it('200-char string is truncated at ≤80 chars and has … indicator (AC-27)', () => {
    const value = 'a'.repeat(200);
    const out = show(value);
    expect(out.startsWith('"')).toBe(true);
    expect(out).toContain('…"');
    // Content should be ≤ MAX_STRING chars + quotes + ellipsis
    expect(out.length).toBeLessThan(200);
  });

  it('short string is not truncated', () => {
    const out = show('hello');
    expect(out).toBe('"hello"');
  });

  // --- Circular reference (AC-28) ---

  it('circular value returns [Circular] without infinite loop (AC-28)', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const out = show(obj);
    expect(out).toContain('[Circular]');
  });

  // --- Leaf types ---

  it('-0 renders as -0', () => {
    expect(show(-0)).toBe('-0');
  });

  it('+0 renders as 0', () => {
    expect(show(+0)).toBe('0');
  });

  it('function renders as [Function]', () => {
    expect(show(() => {})).toBe('[Function]');
  });

  it('Map renders as [Map]', () => {
    expect(show(new Map())).toBe('[Map]');
  });

  it('Set renders as [Set]', () => {
    expect(show(new Set())).toBe('[Set]');
  });

  it('null renders as null', () => {
    expect(show(null)).toBe('null');
  });

  it('undefined renders as undefined', () => {
    expect(show(undefined)).toBe('undefined');
  });

  it('boolean renders as its string', () => {
    expect(show(true)).toBe('true');
    expect(show(false)).toBe('false');
  });

  it('RegExp renders as /source/flags', () => {
    expect(show(/abc/gi)).toBe('/abc/gi');
  });

  it('Date renders as [Date N]', () => {
    const d = new Date(1000);
    expect(show(d)).toBe('[Date 1000]');
  });

  // --- R5: throwing getter renders as [Getter] without invoking (AC-41, 5.2b) ---

  it('throwing getter renders as [Getter] and does not throw (AC-41)', () => {
    const obj = Object.defineProperty({}, 'danger', {
      get() {
        throw new Error('getter should not be called');
      },
      enumerable: true,
    });
    let captured = '';
    expect(() => {
      captured = show(obj);
    }).not.toThrow();
    expect(captured).toContain('[Getter]');
    expect(captured).not.toContain('danger: "');
  });

  it('normal data property renders its value', () => {
    const out = show({ x: 42 });
    expect(out).toContain('x: 42');
  });

  // R5/AC-41: array index accessors must NOT be invoked either
  it('throwing array-index getter renders [Getter] and does not throw (AC-41)', () => {
    const arr: unknown[] = [1];
    Object.defineProperty(arr, '1', {
      get() {
        throw new Error('array getter should not be called');
      },
      enumerable: true,
      configurable: true,
    });
    arr.length = 2;
    let captured = '';
    expect(() => {
      captured = show(arr);
    }).not.toThrow();
    expect(captured).toContain('[Getter]');
  });

  it('sparse array hole renders as undefined', () => {
    const arr: number[] = [1];
    arr[2] = 3; // index 1 is a hole (no own descriptor)
    const out = show(arr);
    expect(out).toContain('undefined');
  });
});
