function syntheticEvent(nativeEvent: Record<string, unknown>): Record<string, unknown> {
  return {
    currentTarget: {},
    target: {},
    preventDefault: function preventDefault(): void {},
    isDefaultPrevented: function isDefaultPrevented(): boolean {
      return false;
    },
    stopPropagation: function stopPropagation(): void {},
    isPropagationStopped: function isPropagationStopped(): boolean {
      return false;
    },
    persist: function persist(): void {},
    isPersistent: function isPersistent(): boolean {
      return false;
    },
    timeStamp: 0,
    nativeEvent,
  };
}

export function touchEvent(): Record<string, unknown> {
  const event = syntheticEvent({
    changedTouches: [],
    identifier: 0,
    locationX: 0,
    locationY: 0,
    pageX: 0,
    pageY: 0,
    target: 0,
    timestamp: Date.now(),
    touches: [],
  });
  event.currentTarget = { measure: function measure(): void {} };
  return event;
}

export function textEvent(nativeEvent: Record<string, unknown>): Record<string, unknown> {
  return syntheticEvent(nativeEvent);
}
