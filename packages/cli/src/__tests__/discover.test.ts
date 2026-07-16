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
});
