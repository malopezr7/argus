import React from 'react';
// Sanctioned cross-package seam: the React-agnostic lifecycle registry remains framework-owned.
import { registerInternalAfterEach } from '../../framework/src/lifecycle.js';
import { waitFor, waitForElementToBeRemoved } from './async.js';
import { fireEvent } from './events.js';
import { type BoundQueries, bindQueries, screen, within } from './queries.js';
import {
  cleanupActiveRenders,
  type RenderResult as RootRenderResult,
  render as renderRoot,
} from './render.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

registerInternalAfterEach(cleanupActiveRenders);

export interface RenderResult extends RootRenderResult, BoundQueries {}

export function render(element: React.ReactElement): RenderResult {
  return bindQueries(renderRoot(element));
}

export { fireEvent, screen, waitFor, waitForElementToBeRemoved, within };

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
export type { WaitForOptions } from './async.js';
export type { BoundQueries, QueryMatcher } from './queries.js';
export type { HostChild, HostNode } from './tree.js';
