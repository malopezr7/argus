import { expect, it, describe as vitestDescribe } from 'vitest';
import {
  beginSnapshotRun,
  beginSnapshotTest,
  configureSnapshots,
  finishSnapshotRun,
  finishSnapshotTest,
  matchSnapshot,
  resetSnapshotsForTesting,
} from '../src/snapshot/state.js';
import { argusExpect, describe, flattenTests, runWith, test } from './run-harness.js';

interface WireSnapshot {
  key: string;
  value: string;
  passed: boolean;
}

function wire(result: { snap?: string }): WireSnapshot[] {
  return result.snap === undefined ? [] : (JSON.parse(result.snap) as WireSnapshot[]);
}

vitestDescribe('snapshot matcher lifecycle', () => {
  it('matches injected entries and emits the exercised bytes', async () => {
    resetSnapshotsForTesting();
    configureSnapshots([['snapshot suite matches 1', '{\n  "value": 1,\n}']], false);

    const result = await runWith(() => {
      describe('snapshot suite', () => {
        test('matches', () => {
          argusExpect({ value: 1 }).toMatchSnapshot();
        });
      });
    });

    expect(result.totals).toMatchObject({ passed: 1, failed: 0 });
    expect(result.snapFiltered).toBe(false);
    expect(wire(result)).toEqual([
      { key: 'snapshot suite matches 1', value: '{\n  "value": 1,\n}', passed: true },
    ]);
  });

  it('accepts a missing entry and an updated mismatch, but rejects a stale mismatch', async () => {
    resetSnapshotsForTesting();
    configureSnapshots([['snap stale 1', '"old"']], false);
    const stale = await runWith(() => {
      describe('snap', () => {
        test('missing', () => argusExpect('new').toMatchSnapshot());
        test('stale', () => argusExpect('new').toMatchSnapshot());
      });
    });

    const staleTests = flattenTests(stale.suites);
    expect(staleTests[0].status).toBe('passed');
    expect(staleTests[1].status).toBe('failed');
    expect(staleTests[1].failureMessage).toContain('Snapshot mismatch');
    expect(stale.snapFiltered).toBe(true);
    expect(wire(stale)).toEqual([
      { key: 'snap missing 1', value: '"new"', passed: true },
      { key: 'snap stale 1', value: '"new"', passed: false },
    ]);

    resetSnapshotsForTesting();
    configureSnapshots([['snap stale 1', '"old"']], true);
    const updated = await runWith(() => {
      describe('snap', () => {
        test('stale', () => argusExpect('new').toMatchSnapshot());
      });
    });

    expect(updated.totals.failed).toBe(0);
    expect(wire(updated)[0]).toEqual({ key: 'snap stale 1', value: '"new"', passed: true });
  });

  it('persists passed-test attempts while marking another test attempts discarded', async () => {
    resetSnapshotsForTesting();
    configureSnapshots([], false);

    const result = await runWith(() => {
      describe('partial', () => {
        test('passes', () => argusExpect('keep').toMatchSnapshot());
        test('fails later', () => {
          argusExpect('discard').toMatchSnapshot();
          argusExpect(false).toBe(true);
        });
      });
    });

    expect(wire(result)).toEqual([
      { key: 'partial passes 1', value: '"keep"', passed: true },
      { key: 'partial fails later 1', value: '"discard"', passed: false },
    ]);
    expect(result.snapFiltered).toBe(true);
  });

  it('marks skip, todo, and focus runs as filtered so pruning cannot happen', async () => {
    resetSnapshotsForTesting();
    configureSnapshots([], true);

    const result = await runWith(() => {
      describe('filtered', () => {
        test.only('focused', () => argusExpect('kept').toMatchSnapshot());
        test('silenced', () => undefined);
        test.todo('later');
      });
    });

    expect(result.snapFiltered).toBe(true);
  });

  it('emits an empty exercised set when an existing entry may have become obsolete', async () => {
    resetSnapshotsForTesting();
    configureSnapshots([['removed snapshot 1', '"old"']], true);

    const result = await runWith(() => {
      describe('removed', () => {
        test('snapshot', () => argusExpect(true).toBe(true));
      });
    });

    expect(result.snap).toBe('[]');
    expect(result.snapFiltered).toBe(false);
  });

  it('uses Jest key conventions for empty and repeated hints', async () => {
    resetSnapshotsForTesting();
    configureSnapshots([], false);

    const result = await runWith(() => {
      describe('hint suite', () => {
        test('keys', () => {
          argusExpect('empty').toMatchSnapshot('');
          argusExpect('first').toMatchSnapshot('named');
          argusExpect('second').toMatchSnapshot('named');
        });
      });
    });

    expect(wire(result).map((entry) => entry.key)).toEqual([
      'hint suite keys 1',
      'hint suite keys: named 1',
      'hint suite keys: named 2',
    ]);
  });

  it('rejects unsupported modifier and invalid hint/key usage exactly once', async () => {
    resetSnapshotsForTesting();
    configureSnapshots([], false);

    const result = await runWith(() => {
      describe('guards', () => {
        test('not', () => argusExpect('x').not.toMatchSnapshot());
        test('async', async () => {
          await argusExpect(Promise.resolve('x')).resolves.toMatchSnapshot();
        });
        test('hint', () => argusExpect('x').toMatchSnapshot('bad\u0000hint'));
      });
    });

    const tests = flattenTests(result.suites);
    expect(tests[0].failureMessage).toBe('toMatchSnapshot() does not support .not');
    expect(tests[1].failureMessage).toBe(
      'toMatchSnapshot() does not support .resolves or .rejects',
    );
    expect(tests[2].failureMessage).toContain('snapshot keys cannot contain C0 control characters');
  });

  it('seals configuration and rejects duplicate injected keys', () => {
    resetSnapshotsForTesting();
    expect(() =>
      configureSnapshots(
        [
          ['same 1', 'a'],
          ['same 1', 'b'],
        ],
        false,
      ),
    ).toThrow(/Duplicate snapshot key/);

    resetSnapshotsForTesting();
    configureSnapshots([], false);
    expect(() => configureSnapshots([], false)).toThrow(/already configured/);
  });

  it('keeps snapshot state and wire escaping independent of user primordial pollution', () => {
    resetSnapshotsForTesting();
    configureSnapshots([], false);

    const mutableObject = Object as unknown as { create: (...args: unknown[]) => object };
    const originalObjectCreate = mutableObject.create;
    const originalNumberToString = Number.prototype.toString;
    const originalStringSlice = String.prototype.slice;
    let failure: unknown;
    let fields: ReturnType<typeof finishSnapshotRun> | undefined;

    mutableObject.create = function poisonedObjectCreate(): never {
      throw new Error('object creation poisoned');
    };
    Number.prototype.toString = function poisonedNumberToString(): never {
      throw new Error('number formatting poisoned');
    };
    String.prototype.slice = function poisonedStringSlice(): never {
      throw new Error('string slicing poisoned');
    };
    try {
      beginSnapshotRun();
      beginSnapshotTest('unicode\u2028key');
      matchSnapshot('value', undefined, false);
      finishSnapshotTest(true);
      fields = finishSnapshotRun(false);
    } catch (error) {
      failure = error;
    } finally {
      mutableObject.create = originalObjectCreate;
      Number.prototype.toString = originalNumberToString;
      String.prototype.slice = originalStringSlice;
    }

    expect(failure).toBeUndefined();
    expect(fields?.snap === undefined ? [] : JSON.parse(fields.snap)).toMatchObject([
      { key: 'unicode\u2028key 1', value: '"value"', passed: true },
    ]);
  });
});
