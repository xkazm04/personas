import { invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";

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

  return Promise.race([invocation, timeout]);
}
