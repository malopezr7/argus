import { deepEqual } from './deep-equal.js';
import { show } from './show.js';

type Assert = (pass: boolean, buildMsg: () => string, buildNotMsg: () => string) => void;
type MockRecordLike = { calls: unknown[][]; results: Array<{ type: string; value: unknown }> };

function mockOf(actual: unknown): MockRecordLike {
  if (actual === null || actual === undefined) {
    throw new Error(`expect(received) received value is not a mock function: ${show(actual)}`);
  }
  const rec = (actual as { mock?: unknown }).mock;
  if (rec === null || typeof rec !== 'object') {
    throw new Error(`expect(received) received value is not a mock function: ${show(actual)}`);
  }
  const candidate = rec as { calls?: unknown; results?: unknown };
  if (!Array.isArray(candidate.calls) || !Array.isArray(candidate.results)) {
    throw new Error(`expect(received) received value is not a mock function: ${show(actual)}`);
  }
  return rec as MockRecordLike;
}

function argsEqual(a: unknown[], b: IArguments): boolean {
  return argsEqualFrom(a, b, 0);
}

function argsEqualFrom(a: unknown[], b: IArguments, offset: number): boolean {
  if (a.length !== b.length - offset) return false;
  for (let i = 0; i < a.length; i++) {
    if (!deepEqual(a[i], b[i + offset], false)) return false;
  }
  return true;
}

function valueEqual(a: unknown, b: unknown): boolean {
  return deepEqual(a, b, false);
}

function showArgs(args: IArguments): string {
  let out = '';
  for (let i = 0; i < args.length; i++) {
    if (i > 0) out += ', ';
    out += show(args[i]);
  }
  return out;
}

export function mixinCallMatchers(
  m: Record<string, unknown>,
  actual: unknown,
  _negated: boolean,
  assert: Assert,
): void {
  m.toHaveBeenCalled = function toHaveBeenCalled(): void {
    const rec = mockOf(actual);
    const pass = rec.calls.length > 0;
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveBeenCalled()`,
      () => `expect(${show(actual)}).not.toHaveBeenCalled()`,
    );
  };

  m.toHaveBeenCalledTimes = function toHaveBeenCalledTimes(n: number): void {
    const rec = mockOf(actual);
    const pass = rec.calls.length === n;
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveBeenCalledTimes(${show(n)})`,
      () => `expect(${show(actual)}).not.toHaveBeenCalledTimes(${show(n)})`,
    );
  };

  m.toHaveBeenCalledWith = function toHaveBeenCalledWith(): void {
    // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17
    const args = arguments;
    const rec = mockOf(actual);
    let pass = false;
    for (let i = 0; i < rec.calls.length; i++) {
      if (argsEqual(rec.calls[i], args)) {
        pass = true;
        break;
      }
    }
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveBeenCalledWith(${showArgs(args)})`,
      () => `expect(${show(actual)}).not.toHaveBeenCalledWith(${showArgs(args)})`,
    );
  };

  m.toHaveBeenLastCalledWith = function toHaveBeenLastCalledWith(): void {
    // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17
    const args = arguments;
    const rec = mockOf(actual);
    const last = rec.calls.length - 1;
    const pass = last >= 0 && argsEqual(rec.calls[last], args);
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveBeenLastCalledWith(${showArgs(args)})`,
      () => `expect(${show(actual)}).not.toHaveBeenLastCalledWith(${showArgs(args)})`,
    );
  };

  m.toHaveBeenNthCalledWith = function toHaveBeenNthCalledWith(n: number): void {
    // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17
    const args = arguments;
    const rec = mockOf(actual);
    const index = n - 1;
    const pass = index >= 0 && index < rec.calls.length && argsEqualFrom(rec.calls[index], args, 1);
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveBeenNthCalledWith(${show(n)}, ${showArgs(args)})`,
      () => `expect(${show(actual)}).not.toHaveBeenNthCalledWith(${show(n)}, ${showArgs(args)})`,
    );
  };

  m.toHaveReturned = function toHaveReturned(): void {
    const rec = mockOf(actual);
    let pass = false;
    for (let i = 0; i < rec.results.length; i++) {
      if (rec.results[i].type === 'return') {
        pass = true;
        break;
      }
    }
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveReturned()`,
      () => `expect(${show(actual)}).not.toHaveReturned()`,
    );
  };

  m.toHaveReturnedTimes = function toHaveReturnedTimes(n: number): void {
    const rec = mockOf(actual);
    let count = 0;
    for (let i = 0; i < rec.results.length; i++) {
      if (rec.results[i].type === 'return') count++;
    }
    const pass = count === n;
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveReturnedTimes(${show(n)})`,
      () => `expect(${show(actual)}).not.toHaveReturnedTimes(${show(n)})`,
    );
  };

  m.toHaveReturnedWith = function toHaveReturnedWith(value: unknown): void {
    const rec = mockOf(actual);
    let pass = false;
    for (let i = 0; i < rec.results.length; i++) {
      if (rec.results[i].type === 'return' && valueEqual(rec.results[i].value, value)) {
        pass = true;
        break;
      }
    }
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveReturnedWith(${show(value)})`,
      () => `expect(${show(actual)}).not.toHaveReturnedWith(${show(value)})`,
    );
  };

  m.toHaveLastReturnedWith = function toHaveLastReturnedWith(value: unknown): void {
    const rec = mockOf(actual);
    const last = rec.results.length - 1;
    const pass =
      last >= 0 &&
      rec.results[last].type === 'return' &&
      valueEqual(rec.results[last].value, value);
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveLastReturnedWith(${show(value)})`,
      () => `expect(${show(actual)}).not.toHaveLastReturnedWith(${show(value)})`,
    );
  };

  m.toHaveNthReturnedWith = function toHaveNthReturnedWith(n: number, value: unknown): void {
    const rec = mockOf(actual);
    const index = n - 1;
    const pass =
      index >= 0 &&
      index < rec.results.length &&
      rec.results[index].type === 'return' &&
      valueEqual(rec.results[index].value, value);
    assert(
      pass,
      () => `expect(${show(actual)}).toHaveNthReturnedWith(${show(n)}, ${show(value)})`,
      () => `expect(${show(actual)}).not.toHaveNthReturnedWith(${show(n)}, ${show(value)})`,
    );
  };
}
