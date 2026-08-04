import React from 'react';
import type { HostNode } from './tree.js';

const DEFAULT_TIMEOUT = 1000;
const DEFAULT_INTERVAL = 50;

/** Millisecond-shaped options matching React Native Testing Library. */
export interface WaitForOptions {
  timeout?: number;
  interval?: number;
}

type PendingState<T> =
  | { status: 'pending' }
  | { status: 'resolved'; value: T }
  | { status: 'rejected'; error: unknown };

type Invocation<T> =
  | { status: 'resolved'; value: T }
  | { status: 'rejected'; error: unknown }
  | { status: 'pending'; state: { current: PendingState<T> } };

interface FlushRequest {
  interval: number;
  resolve(): void;
  reject(error: unknown): void;
}

interface WaitControl {
  cancelled: boolean;
  done: Promise<void>;
  complete(): void;
}

const flushRequests: FlushRequest[] = [];
const activeWaits: WaitControl[] = [];
let flushInProgress = false;
let invokeDepth = 0;

function validateOptions(timeout: number, interval: number): void {
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError('waitFor timeout must be a finite number greater than or equal to 0');
  }
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new TypeError('waitFor interval must be a finite number greater than 0');
  }
}

function resultMissedDeadline(startedAt: number, timeout: number): boolean {
  const elapsed = Date.now() - startedAt;
  return elapsed >= timeout && (timeout !== 0 || elapsed > 0);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Invoke without returning a promise from the act callback, so a pending callback cannot hang act. */
function invoke<T>(expectation: () => T): Invocation<Awaited<T>> {
  let invocation: Invocation<Awaited<T>> | undefined;

  invokeDepth++;
  try {
    React.act(() => {
      try {
        const result = expectation();
        if (isThenable(result)) {
          const state: { current: PendingState<Awaited<T>> } = {
            current: { status: 'pending' },
          };
          Promise.resolve(result).then(
            function resolved(value): void {
              state.current = { status: 'resolved', value: value as Awaited<T> };
            },
            function rejected(error): void {
              state.current = { status: 'rejected', error };
            },
          );
          invocation = { status: 'pending', state };
        } else {
          invocation = { status: 'resolved', value: result as Awaited<T> };
        }
      } catch (error) {
        invocation = { status: 'rejected', error };
      }
    });
  } catch (error) {
    return { status: 'rejected', error };
  } finally {
    invokeDepth--;
    if (invokeDepth === 0) startNextFlush();
  }

  return (
    invocation ?? {
      status: 'rejected',
      error: new Error('waitFor could not invoke its callback'),
    }
  );
}

/**
 * Yield one timer turn inside async act, then let React flush the work that turn queued.
 *
 * Standalone Hermes treats the delay as FIFO metadata rather than elapsed time.
 * The caller therefore also counts these turns instead of trusting the delay.
 */
function settleFlush(request: FlushRequest, rejected: boolean, error?: unknown): void {
  flushRequests.splice(0, 1);
  flushInProgress = false;

  if (rejected) request.reject(error);
  else request.resolve();

  startNextFlush();
}

function startNextFlush(): void {
  if (invokeDepth > 0 || flushInProgress || flushRequests.length === 0) return;

  const request = flushRequests[0];
  flushInProgress = true;

  let actResult: PromiseLike<unknown>;
  try {
    actResult = React.act(async function flushActTurn(): Promise<void> {
      await new Promise<void>(function schedule(resolve): void {
        setTimeout(resolve, request.interval);
      });
    });
  } catch (error) {
    settleFlush(request, true, error);
    return;
  }

  Promise.resolve(actResult).then(
    function flushed(): void {
      settleFlush(request, false);
    },
    function flushFailed(error): void {
      settleFlush(request, true, error);
    },
  );
}

function flushTurn(interval: number): Promise<void> {
  return new Promise<void>(function enqueueFlush(resolve, reject): void {
    flushRequests[flushRequests.length] = { interval, resolve, reject };
    startNextFlush();
  });
}

function createWaitControl(): WaitControl {
  let complete: (() => void) | undefined;
  const done = new Promise<void>(function waitForCompletion(resolve): void {
    complete = resolve;
  });
  return {
    cancelled: false,
    done,
    complete(): void {
      complete?.();
    },
  };
}

function registerWait(control: WaitControl): void {
  activeWaits[activeWaits.length] = control;
}

function unregisterWait(control: WaitControl): void {
  for (let i = 0; i < activeWaits.length; i++) {
    if (activeWaits[i] === control) {
      activeWaits.splice(i, 1);
      break;
    }
  }
  control.complete();
}

/** Cancel and drain waits the test abandoned before its component tree is unmounted. */
export async function cleanupAsyncWaits(): Promise<void> {
  const waits: WaitControl[] = [];
  for (let i = 0; i < activeWaits.length; i++) {
    const control = activeWaits[i];
    control.cancelled = true;
    waits[waits.length] = control;
  }
  for (let i = 0; i < waits.length; i++) {
    await waits[i].done;
  }
}

function callbackMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error === undefined) return 'Timed out in waitFor.';
  return String(error);
}

function exhaustedError(
  reason: 'wall-clock' | 'poll',
  lastError: unknown,
  timeout: number,
  interval: number,
  polls: number,
  attempts: number,
): Error {
  const cause = callbackMessage(lastError);
  const budget =
    reason === 'wall-clock'
      ? `the wall-clock budget was exhausted after ${attempts} callback attempt(s)`
      : `the ${Math.max(1, Math.ceil(timeout / interval))}-turn poll budget was exhausted ` +
        `after ${polls} scheduler turn(s) and ${attempts} callback attempt(s)`;
  const message =
    `${cause}\n\nwaitFor stopped because ${budget} ` +
    `(timeout: ${timeout} ms, interval: ${interval} ms).`;

  if (lastError instanceof Error) {
    const originalMessage = lastError.message;
    const originalStack = lastError.stack;
    lastError.message = message;
    if (originalStack !== undefined) {
      lastError.stack = originalStack.replace(originalMessage, message);
    }
    return lastError;
  }
  return new Error(message);
}

/**
 * Retry until `expectation` stops throwing or its returned promise resolves.
 *
 * Both a real wall-clock deadline and a derived scheduler-turn budget apply. The
 * first exhausted budget wins, so Hermes' zero-delay timer queue cannot spin a
 * test until the enclosing file timeout discards every result.
 */
export async function waitFor<T>(
  expectation: () => T,
  options: WaitForOptions = {},
): Promise<Awaited<T>> {
  if (typeof expectation !== 'function') {
    throw new TypeError('waitFor expectation must be a function');
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? DEFAULT_INTERVAL;
  validateOptions(timeout, interval);

  const control = createWaitControl();
  registerWait(control);
  const startedAt = Date.now();
  const pollLimit = Math.max(1, Math.ceil(timeout / interval));
  let polls = 0;
  let attempts = 0;
  let lastError: unknown;
  let pending: { current: PendingState<Awaited<T>> } | undefined;
  let needsAttempt = true;

  try {
    while (true) {
      if (control.cancelled) return undefined as Awaited<T>;

      if (pending !== undefined) {
        if (pending.current.status === 'resolved') {
          if (resultMissedDeadline(startedAt, timeout)) {
            throw exhaustedError('wall-clock', lastError, timeout, interval, polls, attempts);
          }
          return pending.current.value;
        }
        if (pending.current.status === 'rejected') {
          lastError = pending.current.error;
          pending = undefined;
          needsAttempt = true;
        }
      }

      if (needsAttempt) {
        if (attempts > 0 && Date.now() - startedAt >= timeout) {
          throw exhaustedError('wall-clock', lastError, timeout, interval, polls, attempts);
        }

        const current = invoke(expectation);
        attempts++;
        needsAttempt = false;
        if (current.status === 'resolved') {
          if (resultMissedDeadline(startedAt, timeout)) {
            throw exhaustedError('wall-clock', lastError, timeout, interval, polls, attempts);
          }
          return current.value;
        }
        if (current.status === 'pending') pending = current.state;
        else {
          lastError = current.error;
          needsAttempt = true;
        }
      }

      if (Date.now() - startedAt >= timeout) {
        throw exhaustedError('wall-clock', lastError, timeout, interval, polls, attempts);
      }
      if (polls >= pollLimit) {
        throw exhaustedError('poll', lastError, timeout, interval, polls, attempts);
      }

      try {
        await flushTurn(interval);
      } catch (error) {
        if (control.cancelled) return undefined as Awaited<T>;
        throw error;
      }
      polls++;
    }
  } finally {
    unregisterWait(control);
  }
}

type RemovableElement = HostNode | readonly HostNode[];

function isHostNode(value: unknown): value is HostNode {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<HostNode>;
  return typeof candidate.type === 'string' && Array.isArray(candidate.children);
}

function isDetached(node: HostNode): boolean {
  return node.type !== '' && node.parent === null;
}

function isRemoved(value: unknown): boolean {
  if (!value) return true;
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    let allHostNodes = true;
    for (let i = 0; i < value.length; i++) {
      if (!isHostNode(value[i])) {
        allHostNodes = false;
        break;
      }
      if (!isDetached(value[i])) return false;
    }
    return allHostNodes;
  }
  return isHostNode(value) ? isDetached(value) : false;
}

/** Wait for an initially-present query result or held host element to disappear. */
export function waitForElementToBeRemoved<T>(
  callback: () => T,
  options?: WaitForOptions,
): Promise<T>;
export function waitForElementToBeRemoved<T extends RemovableElement>(
  element: T,
  options?: WaitForOptions,
): Promise<T>;
export async function waitForElementToBeRemoved<T>(
  callbackOrElement: (() => T) | RemovableElement,
  options?: WaitForOptions,
): Promise<T> {
  const expectation: () => T =
    typeof callbackOrElement === 'function'
      ? callbackOrElement
      : () => (isRemoved(callbackOrElement) ? null : callbackOrElement) as T;

  const initialElements = expectation();
  if (isRemoved(initialElements)) {
    throw new Error(
      'The element(s) given to waitForElementToBeRemoved are already removed. ' +
        'waitForElementToBeRemoved requires that the element(s) exist before waiting for removal.',
    );
  }

  return waitFor(() => {
    let result: T;
    try {
      result = expectation();
    } catch {
      return initialElements;
    }

    if (isRemoved(result)) return initialElements;
    throw new Error('Timed out in waitForElementToBeRemoved.');
  }, options);
}
