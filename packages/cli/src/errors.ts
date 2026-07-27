/**
 * Extract a message from an unknown throw.
 *
 * `catch` binds `unknown`, and not everything thrown is an `Error` — a rejected
 * promise can carry a string, a plain object, or `undefined`. Reading `.message`
 * only when it is actually there keeps a bad throw from becoming a second,
 * more confusing crash inside the error path.
 */
export function errMsg(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e);
}
