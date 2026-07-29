import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveFiles } from '../discover.js';

describe('resolveFiles', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'argus-discover-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('(a) default patterns match .test.ts and .test.tsx in lexicographic order', async () => {
    writeFileSync(join(tmp, 'foo.test.ts'), '');
    writeFileSync(join(tmp, 'bar.test.tsx'), '');
    writeFileSync(join(tmp, 'baz.ts'), ''); // should not match

    const result = await resolveFiles([], tmp);

    expect(result).toHaveLength(2);
    expect(result).toEqual([join(tmp, 'bar.test.tsx'), join(tmp, 'foo.test.ts')]);
  });

  it('(b) node_modules files are excluded', async () => {
    writeFileSync(join(tmp, 'real.test.ts'), '');
    mkdirSync(join(tmp, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(tmp, 'node_modules', 'pkg', 'sneaky.test.ts'), '');

    const result = await resolveFiles([], tmp);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/real\.test\.ts$/);
    expect(result.every((f) => !f.includes('node_modules'))).toBe(true);
  });

  it('(c) two overlapping globs deduplicate to one entry', async () => {
    mkdirSync(join(tmp, 'sub'), { recursive: true });
    writeFileSync(join(tmp, 'sub', 'shared.test.ts'), '');

    // Both patterns match the same file
    const result = await resolveFiles(['**/*.test.ts', 'sub/**/*.test.ts'], tmp);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/shared\.test\.ts$/);
  });

  it('(d) results are sorted lexicographically by absolute path', async () => {
    writeFileSync(join(tmp, 'c.test.ts'), '');
    writeFileSync(join(tmp, 'a.test.ts'), '');
    writeFileSync(join(tmp, 'b.test.ts'), '');

    const result = await resolveFiles([], tmp);

    expect(result).toHaveLength(3);
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });

  it('(e) zero matches returns empty array', async () => {
    // No files in tmp
    const result = await resolveFiles(['**/*.test.ts'], tmp);
    expect(result).toEqual([]);
  });

  it('explicit pattern discovers matching files', async () => {
    mkdirSync(join(tmp, 'examples'), { recursive: true });
    writeFileSync(join(tmp, 'examples', 'math.test.ts'), '');
    writeFileSync(join(tmp, 'examples', 'component.test.tsx'), '');
    writeFileSync(join(tmp, 'examples', 'other.ts'), '');

    const result = await resolveFiles(['examples/**/*.test.ts'], tmp);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/math\.test\.ts$/);
    expect(result[0]).not.toMatch(/\.tsx$/);
  });

  /**
   * The exclusion used to be `path.includes('node_modules')`, a SUBSTRING test.
   * A directory whose name merely contains the string — a fixtures directory
   * about node_modules is the obvious one — was silently skipped, and the user
   * got a green run over tests that never executed. Exclusion is a path-segment
   * question, so it is asked with a glob.
   */
  it('keeps a directory whose name merely contains "node_modules"', async () => {
    mkdirSync(join(tmp, 'my-node_modules-fixtures'), { recursive: true });
    writeFileSync(join(tmp, 'my-node_modules-fixtures', 'real.test.ts'), '');

    const result = await resolveFiles([], tmp);

    expect(result).toEqual([join(tmp, 'my-node_modules-fixtures', 'real.test.ts')]);
  });

  it('excludes a nested node_modules, not only one at the root', async () => {
    mkdirSync(join(tmp, 'packages', 'a', 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(tmp, 'packages', 'a', 'node_modules', 'dep', 'sneaky.test.ts'), '');
    writeFileSync(join(tmp, 'packages', 'a', 'real.test.ts'), '');

    const result = await resolveFiles([], tmp);

    expect(result).toEqual([join(tmp, 'packages', 'a', 'real.test.ts')]);
  });

  /**
   * A test file under `dist/` is a COMPILED COPY of one already under source.
   * Running it duplicates the test and reports stack traces pointing at
   * generated code, so build output is excluded by default.
   */
  it.each(['dist', 'build', 'coverage', '.git'])('excludes %s by default', async (dir) => {
    mkdirSync(join(tmp, dir), { recursive: true });
    writeFileSync(join(tmp, dir, 'copy.test.ts'), '');
    writeFileSync(join(tmp, 'source.test.ts'), '');

    const result = await resolveFiles([], tmp);

    expect(result).toEqual([join(tmp, 'source.test.ts')]);
  });

  it('applies caller-supplied excludes instead of the defaults', async () => {
    mkdirSync(join(tmp, 'dist'), { recursive: true });
    mkdirSync(join(tmp, 'fixtures'), { recursive: true });
    writeFileSync(join(tmp, 'dist', 'emitted.test.ts'), '');
    writeFileSync(join(tmp, 'fixtures', 'ignored.test.ts'), '');

    const result = await resolveFiles([], tmp, ['**/fixtures/**']);

    expect(result).toEqual([join(tmp, 'dist', 'emitted.test.ts')]);
  });

  it('excludes nothing when given an empty exclude list', async () => {
    mkdirSync(join(tmp, 'node_modules'), { recursive: true });
    writeFileSync(join(tmp, 'node_modules', 'dep.test.ts'), '');

    const result = await resolveFiles([], tmp, []);

    expect(result).toEqual([join(tmp, 'node_modules', 'dep.test.ts')]);
  });

  /**
   * Absolute patterns used to be joined onto the root unconditionally, which
   * produced `<root><root>/file.test.ts` — a path that cannot exist, so the run
   * died in the bundler. Anyone pasting a full path out of an editor, or
   * scripting Argus, hit it on the first try.
   */
  describe('absolute patterns', () => {
    it('runs an absolute path to a single file', async () => {
      const file = join(tmp, 'abs.test.ts');
      writeFileSync(file, '');

      expect(await resolveFiles([file], tmp)).toEqual([file]);
    });

    it('resolves an absolute glob', async () => {
      mkdirSync(join(tmp, 'sub'), { recursive: true });
      writeFileSync(join(tmp, 'sub', 'a.test.ts'), '');
      writeFileSync(join(tmp, 'b.test.ts'), '');

      const result = await resolveFiles([join(tmp, '**/*.test.ts')], tmp);

      expect(result).toEqual([join(tmp, 'b.test.ts'), join(tmp, 'sub', 'a.test.ts')]);
    });

    it('never prepends the root to a path that already has one', async () => {
      const file = join(tmp, 'abs.test.ts');
      writeFileSync(file, '');

      for (const hit of await resolveFiles([file], tmp)) {
        expect(hit.indexOf(tmp)).toBe(hit.lastIndexOf(tmp));
      }
    });

    it('deduplicates a file named both absolutely and relatively', async () => {
      const file = join(tmp, 'same.test.ts');
      writeFileSync(file, '');

      expect(await resolveFiles([file, 'same.test.ts'], tmp)).toEqual([file]);
    });

    it('is still subject to exclusion', async () => {
      mkdirSync(join(tmp, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(tmp, 'node_modules', 'pkg', 'sneaky.test.ts'), '');
      writeFileSync(join(tmp, 'real.test.ts'), '');

      expect(await resolveFiles([join(tmp, '**/*.test.ts')], tmp)).toEqual([
        join(tmp, 'real.test.ts'),
      ]);
    });

    it('honours a root-anchored exclude', async () => {
      mkdirSync(join(tmp, 'fixtures'), { recursive: true });
      writeFileSync(join(tmp, 'fixtures', 'f.test.ts'), '');
      writeFileSync(join(tmp, 'real.test.ts'), '');

      const result = await resolveFiles([join(tmp, '**/*.test.ts')], tmp, ['fixtures/**']);

      expect(result).toEqual([join(tmp, 'real.test.ts')]);
    });
  });

  /**
   * A pattern may point outside `root` — an absolute path from another
   * directory, or a `../` glob. Returning nothing would be the worst answer:
   * the user named a file that exists and got a silent empty run. The file is
   * returned, and exclusion still applies to it.
   */
  describe('patterns that escape the root', () => {
    let outside: string;

    beforeEach(() => {
      outside = mkdtempSync(join(tmpdir(), 'argus-outside-'));
      mkdirSync(join(outside, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(outside, 'o.test.ts'), '');
      writeFileSync(join(outside, 'node_modules', 'pkg', 'sneaky.test.ts'), '');
    });

    afterEach(() => {
      rmSync(outside, { recursive: true, force: true });
    });

    it('returns a file named by an absolute path outside the root', async () => {
      const result = await resolveFiles([join(outside, '**/*.test.ts')], tmp);

      expect(result).toEqual([join(outside, 'o.test.ts')]);
    });

    it('excludes node_modules outside the root too', async () => {
      const result = await resolveFiles([join(outside, '**/*.test.ts')], tmp);

      expect(result.some((f) => f.includes('node_modules'))).toBe(false);
    });

    it('applies exclusion to a relative pattern that climbs out of the root', async () => {
      const nested = join(outside, 'root');
      mkdirSync(nested, { recursive: true });

      const result = await resolveFiles(['../**/*.test.ts'], nested);

      expect(result.some((f) => f.includes('node_modules'))).toBe(false);
      expect(result).toContain(join(outside, 'o.test.ts'));
    });

    /**
     * `relative()` yields '..dotted/real.test.ts' here — two leading dots, yet
     * the file sits INSIDE the root. It is named literally because a `**` glob
     * never descends into a dot-directory.
     *
     * This pins that such a file is still discovered. It does NOT pin how
     * `escapesRoot` classifies it: for a hit under the root, Node's own
     * exclusion has already run and is a superset of ours, so classifying it as
     * an escape changes no output. The segment-wise check there is defensive.
     */
    it('discovers a file inside a directory whose name starts with two dots', async () => {
      mkdirSync(join(tmp, '..dotted'), { recursive: true });
      const file = join(tmp, '..dotted', 'real.test.ts');
      writeFileSync(file, '');

      expect(await resolveFiles([file], tmp)).toEqual([file]);
    });
  });
});
