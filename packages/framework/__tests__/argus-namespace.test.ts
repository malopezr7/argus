import { describe, expect, it } from 'vitest';
import { installArgusNamespace } from '../src/argus-namespace.js';
import { installGlobals } from '../src/jest-api.js';
import { expect as argusExpect } from '../src/matchers.js';

describe('installArgusNamespace', () => {
  it('installs argus functions without installing a jest global', () => {
    const g: Record<string, unknown> = { expect: argusExpect };

    installGlobals(g);
    installArgusNamespace(g);

    const argus = g.argus as Record<string, unknown>;
    expect(typeof argus).toBe('object');
    expect(typeof argus.fn).toBe('function');
    expect(typeof argus.spyOn).toBe('function');
    expect(typeof argus.mockNativeModule).toBe('function');
    expect(typeof argus.resetNativeModules).toBe('function');
    expect(g.jest).toBeUndefined();
  });

  it('does not disturb runner globals', () => {
    const g: Record<string, unknown> = { expect: argusExpect };

    installGlobals(g);
    installArgusNamespace(g);

    expect(typeof g.describe).toBe('function');
    expect(typeof g.test).toBe('function');
    expect(typeof g.it).toBe('function');
    expect(typeof g.expect).toBe('function');
    expect(g.it).toBe(g.test);
  });
});
