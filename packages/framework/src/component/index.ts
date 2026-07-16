import React from 'react';
import { registerInternalAfterEach } from '../lifecycle.js';
import { fireEvent } from './events.js';
import { screen, within } from './queries.js';
import { cleanupActiveRenders, refreshActiveRenders, render } from './render.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

registerInternalAfterEach(cleanupActiveRenders);

export { fireEvent, render, screen, within };

export function act(callback: () => void): void {
  React.act(callback);
  refreshActiveRenders();
}
export type { TestInstance } from 'test-renderer';
export type { BoundQueries, QueryMatcher } from './queries.js';
export type { RenderResult } from './render.js';
export type { HostChild, HostNode } from './tree.js';
