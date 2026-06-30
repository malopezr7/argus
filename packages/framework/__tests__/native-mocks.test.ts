import { describe, expect, it } from 'vitest';
import { argusFn } from '../src/mock-fn.js';
import {
  mockNativeModule,
  NativeModules,
  resetNativeModules,
  TurboModuleRegistry,
} from '../src/native-mocks.js';

describe('native mock registry', () => {
  it('getEnforcing returns a registered module', () => {
    resetNativeModules();

    mockNativeModule('Foo', () => ({ bar: argusFn() }));

    expect(TurboModuleRegistry.getEnforcing('Foo')).toBe(NativeModules.Foo);
    expect(typeof (TurboModuleRegistry.getEnforcing('Foo') as { bar: unknown }).bar).toBe(
      'function',
    );
  });

  it('getEnforcing throws for an unregistered module', () => {
    resetNativeModules();

    expect(() => TurboModuleRegistry.getEnforcing('Missing')).toThrow(/not registered/);
  });

  it('get returns falsy for an unregistered module and does not throw', () => {
    resetNativeModules();

    expect(TurboModuleRegistry.get('Missing')).toBeNull();
  });

  it('NativeModules omits unknown names', () => {
    resetNativeModules();

    expect(NativeModules.Unknown).toBeUndefined();
  });

  it('mockNativeModule registers a fresh module visible through all surfaces', () => {
    resetNativeModules();
    let factoryCalls = 0;

    mockNativeModule('Foo', () => {
      factoryCalls++;
      return { tag: `module-${factoryCalls}` };
    });

    expect(factoryCalls).toBe(1);
    expect(NativeModules.Foo).toEqual({ tag: 'module-1' });
    expect(TurboModuleRegistry.get('Foo')).toBe(NativeModules.Foo);
    expect(TurboModuleRegistry.getEnforcing('Foo')).toBe(NativeModules.Foo);
  });

  it('re-registering replaces the prior mock', () => {
    resetNativeModules();

    mockNativeModule('Foo', () => ({ tag: 'first' }));
    mockNativeModule('Foo', () => ({ tag: 'second' }));

    expect((TurboModuleRegistry.getEnforcing('Foo') as { tag: string }).tag).toBe('second');
  });

  it('resetNativeModules clears all names', () => {
    resetNativeModules();
    mockNativeModule('Foo', () => ({ bar: argusFn() }));

    resetNativeModules();

    expect(() => TurboModuleRegistry.getEnforcing('Foo')).toThrow(/not registered/);
    expect(TurboModuleRegistry.get('Foo')).toBeNull();
    expect(NativeModules.Foo).toBeUndefined();
  });
});
