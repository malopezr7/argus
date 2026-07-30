import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const CLI_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Every `process.exit(...)` CALL in a file, as `line:text`.
 *
 * Parsed rather than pattern-matched. The first version of this check searched
 * the text with a regex and blanked comments first — and a `'typo/**'` inside
 * one of those comments opened a block-comment match that ran to the next `*​/`
 * in the file, silently swallowing the real call underneath. The check passed
 * while the defect was present, which is the only failure mode a guard like
 * this really has. The parser has no such ambiguity: a comment is a comment and
 * a call is a call.
 */
function exitCalls(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'process' &&
        callee.name.text === 'exit'
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push(`${line + 1}:${node.getText(source)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * `process.exit()` tears the process down at once. Anything still sitting in a
 * pipe buffer is discarded — and stdout and stderr ARE pipes whenever the
 * output is redirected to a file, piped to another command, or captured by CI.
 *
 * The CLI had one such call, on the "no test files matched" path, immediately
 * after writing the line that explains the failure. Run interactively it looked
 * fine, because a TTY write is synchronous. Redirected, the exit code arrived
 * without the message that made sense of it: `argus 'nope/**' 2> log` could
 * leave `log` empty.
 *
 * `process.exitCode` sets the status and lets Node exit normally once the event
 * loop drains, which flushes the writes. Everywhere else in this CLI already
 * did that, so the one exception was also an inconsistency.
 */
describe('the CLI never calls process.exit', () => {
  const files = sourceFiles(CLI_SRC);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [relative(CLI_SRC, file), file]))(
    '%s sets process.exitCode instead of calling process.exit',
    (_label, file) => {
      expect(exitCalls(file)).toEqual([]);
    },
  );
});
