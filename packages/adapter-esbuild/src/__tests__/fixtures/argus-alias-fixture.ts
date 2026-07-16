// @ts-nocheck — the bare alias is intentionally resolved by EsbuildBundler.
import { render } from 'argus';

export const aliasMarker = typeof render === 'function' ? 'argus-alias-resolved' : 'missing';
console.log(aliasMarker);
