declare const argus: {
  useFakeTimers(config?: { now?: number | Date; timerLimit?: number }): unknown;
};

// This dependency evaluates before the component-testing module in the importing
// fixture. Internal schedulers must still use primordials captured by the framework.
argus.useFakeTimers({ now: 1000 });
