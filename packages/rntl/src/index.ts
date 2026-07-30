import React from 'react';
// Sanctioned cross-package seam: the React-agnostic lifecycle registry remains framework-owned.
import { registerInternalAfterEach } from '../../framework/src/lifecycle.js';
import { fireEvent } from './events.js';
import { screen, within } from './queries.js';
import { cleanupActiveRenders, render } from './render.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

registerInternalAfterEach(cleanupActiveRenders);

export { fireEvent, render, screen, within };

/**
 * Run `callback` inside React's act scope and flush what it queued.
 *
 * The wrapper stays because `React.act` returns a thenable the synchronous API
 * has no use for. It does not refresh anything: host nodes read through to the
 * fiber, so the flushed tree is already visible.
 */
export function act(callback: () => void): void {
  React.act(callback);
}
export type { TestInstance } from 'test-renderer';
export type { BoundQueries, QueryMatcher } from './queries.js';
export type { RenderResult } from './render.js';
export type { HostChild, HostNode } from './tree.js';
