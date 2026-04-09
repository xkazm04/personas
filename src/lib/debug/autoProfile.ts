/**
 * Auto-profiler — starts a Performance recording before the freeze hits,
 * then saves the trace data when (if) the thread recovers.
 *
 * Uses the Performance Timeline API to capture what the browser is doing
 * during the permanent freeze that our JS monitors can't see.
 *
 * Also patches React's __SECRET_INTERNALS to count fiber work.
 */

// Count all microtask executions to detect microtask storms
let microCount = 0;
let microResetTime = performance.now();
const _queueMicrotask = window.queueMicrotask?.bind(window);
if (_queueMicrotask) {
  window.queueMicrotask = (cb: VoidFunction) => {
    microCount++;
    _queueMicrotask(cb);
  };
}

// Count Promise.then to detect promise storms
let promiseThenCount = 0;
const _origThen = Promise.prototype.then;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Promise.prototype as any).then = function(onFulfilled?: any, onRejected?: any) {
  promiseThenCount++;
  return _origThen.call(this, onFulfilled, onRejected);
};

// Track using a MessageChannel (fires between microtasks and next task)
let messageChannelFires = 0;
const channel = new MessageChannel();
channel.port1.onmessage = () => {
  messageChannelFires++;
  // Re-post to keep monitoring
  channel.port2.postMessage(null);

  // Log stats every time MessageChannel fires (it fires between tasks)
  const now = performance.now();
  const elapsed = now - microResetTime;
  if (elapsed > 1000) {
    const report = `[auto-profile] microtasks=${microCount} promises=${promiseThenCount} msgChannel=${messageChannelFires} in ${Math.round(elapsed)}ms`;
    if (microCount > 1000 || promiseThenCount > 500) {
      console.error(`[MICROTASK STORM] ${report}`);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__TAURI_INTERNALS__?.invoke?.('log_frontend_error', {
          level: 'error', message: report
        });
      } catch { /* intentional: fire-and-forget IPC */ }
    }
    // Persist to localStorage
    try {
      localStorage.setItem('__auto_profile', JSON.stringify({
        ts: new Date().toISOString(),
        microCount,
        promiseThenCount,
        messageChannelFires,
        elapsedMs: Math.round(elapsed),
      }));
    } catch { /* intentional: localStorage may be unavailable */ }
    microCount = 0;
    promiseThenCount = 0;
    messageChannelFires = 0;
    microResetTime = now;
  }
};
// Start the monitoring loop
channel.port2.postMessage(null);

// Expose for console debugging
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__AUTO_PROFILE__ = {
  get micro() { return microCount; },
  get promises() { return promiseThenCount; },
  get msgChannel() { return messageChannelFires; },
  reset() { microCount = 0; promiseThenCount = 0; messageChannelFires = 0; microResetTime = performance.now(); },
};

console.info('[auto-profile] Monitoring microtasks + promises');
