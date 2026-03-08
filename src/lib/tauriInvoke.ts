import { invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import { recordIpcCall } from "./ipcMetrics";

/** Default timeout for Tauri IPC calls (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

export class InvokeTimeoutError extends Error {
  constructor(cmd: string, timeoutMs: number) {
    super(`Tauri invoke "${cmd}" timed out after ${timeoutMs}ms`);
    this.name = "InvokeTimeoutError";
  }
}

/**
 * Wrapper around Tauri's `invoke()` that adds a configurable timeout via
 * `Promise.race`. If the backend doesn't respond within `timeoutMs` the
 * returned promise rejects with an `InvokeTimeoutError`.
 *
 * Every call is recorded into the IPC metrics ring buffer for observability.
 *
 * @param cmd      The Tauri command name.
 * @param args     Optional arguments forwarded to `invoke`.
 * @param options  Optional InvokeOptions forwarded to `invoke`.
 * @param timeoutMs Timeout in milliseconds. Defaults to 30 000 (30 s).
 */
export function invokeWithTimeout<T>(
  cmd: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const start = performance.now();
  const invocation = invoke<T>(cmd, args, options);

  const timeout = new Promise<never>((_resolve, reject) => {
    const id = setTimeout(() => {
      reject(new InvokeTimeoutError(cmd, timeoutMs));
    }, timeoutMs);

    // Ensure the timer doesn't keep the process alive if the invoke resolves
    // first.  We attach a cleanup to the original promise so the timeout is
    // cleared as soon as it settles (fulfilled *or* rejected).
    void invocation.finally(() => clearTimeout(id));
  });

  return Promise.race([invocation, timeout]).then(
    (result) => {
      recordIpcCall({ command: cmd, durationMs: performance.now() - start, ok: true, timestamp: Date.now() });
      return result;
    },
    (err) => {
      recordIpcCall({ command: cmd, durationMs: performance.now() - start, ok: false, timestamp: Date.now() });
      throw err;
    },
  );
}
