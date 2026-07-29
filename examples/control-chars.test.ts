/**
 * Adversarial fixture: the RESULT-CHANNEL must carry the WHOLE C0 range.
 *
 * JSON forbids a raw U+0000–U+001F inside a string. The serializer escaped only
 * the five characters with short forms (\b \t \n \f \r) plus `"` and `\`, so any
 * other control character — an ESC from a terminal-colour assertion, a NUL from
 * a binary fixture, a VT from pasted text — went out raw and the host could not
 * parse the envelope. One such character anywhere in one test name or one
 * failure message took down every result in the file with
 * `PROTOCOL FAILURE [malformed-json]`, including the tests that had passed.
 *
 * U+000A and U+000D matter twice over: the result is ONE framed line, so a raw
 * newline would break the framing itself, not just the JSON.
 *
 * Expected: all tests pass, exit code 0. A regression shows up as a protocol
 * failure for the whole file rather than as a failing test.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };

/** U+0000–U+001F: every character JSON requires to be escaped. */
const C0_END = 0x20;

/**
 * Register one test whose NAME carries `code`, so the character has to survive
 * serialization on the Hermes side and JSON.parse on the host.
 *
 * The code arrives as a FUNCTION PARAMETER rather than being read from the loop
 * binding: esbuild lowers loop-`const` to `var` for the Hermes target, so a
 * closure over the loop variable would see only the final iteration.
 */
function registerControlChar(code: number): void {
  const ch = String.fromCharCode(code);
  test(`C0 ${code} [ ${ch} ] round-trips`, () => {
    expect(ch.length).toBe(1);
    expect(`a${ch}b`.length).toBe(3);
    expect(`a${ch}b`.charCodeAt(1)).toBe(code);
  });
}

/** Every C0 character in one string, for a name that exercises the whole range. */
function allControlChars(): string {
  let out = '';
  for (let code = 0; code < C0_END; code++) out += String.fromCharCode(code);
  return out;
}

describe(`C0 control characters [ ${allControlChars()} ]`, () => {
  for (let code = 0; code < C0_END; code++) registerControlChar(code);

  test(`all 32 at once [ ${allControlChars()} ]`, () => {
    expect(allControlChars().length).toBe(C0_END);
  });

  test('a control character compared as a VALUE does not break the run', () => {
    // The original report: `expect('a\u001bb').toBe('X')` put a raw ESC into a
    // failure message. Comparing them successfully keeps this fixture green
    // while still driving the same characters through the matcher.
    expect('a\u001bb').toBe('a\u001bb');
  });

  test('the escape table cannot be poisoned from user code', () => {
    // Escaping the C0 range needs a character -> escape lookup, and a lookup is
    // something user code can try to answer. This registers the attack against
    // it: the table is built at module-eval and owns all 32 keys with a null
    // prototype, so neither of these can reach it.
    //
    // Serialization happens after every test body has run, so polluting here is
    // polluting BEFORE the envelope is written. Proof is on the host side — the
    // names above have to come back byte-identical anyway.
    const proto = Object.prototype as unknown as Record<string, string>;
    for (let code = 0; code < C0_END; code++) {
      // If the table consulted its prototype, every control character would
      // serialize as a capital A.
      proto[String.fromCharCode(code)] = '\\u0041';
    }
    // And if the table were built lazily rather than at module-eval, these
    // would be the primordials it used.
    (globalThis as unknown as Record<string, unknown>).String = {
      fromCharCode: () => 'X',
    };
    (Object as unknown as Record<string, unknown>).create = () => ({});

    expect(true).toBe(true);
  });
});
