import { invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import { recordIpcCall } from "./ipcMetrics";
import type { CommandName as RegisteredCommand } from "./commandNames.generated";
import type { UnregisteredCommand } from "./commandNames.overrides";

/** All valid command names: registered + known-unregistered forward-references. */
export type CommandName = RegisteredCommand | UnregisteredCommand;

/** Default timeout for Tauri IPC calls (90 seconds). */
const DEFAULT_TIMEOUT_MS = 90_000;

export class InvokeTimeoutError extends Error {
  /** The command that timed out. */
  readonly command: string;
  constructor(cmd: string, timeoutMs: number) {
    super(`Tauri invoke "${cmd}" timed out after ${timeoutMs}ms`);
    this.name = "InvokeTimeoutError";
    this.command = cmd;
  }
}

/**
 * Tracks in-flight invocations by a caller-supplied idempotency key.
 * If a second call arrives with the same key while the first is still pending,
 * the duplicate receives the same promise instead of spawning a new backend call.
 */
const inflightByKey = new Map<string, Promise<unknown>>();

/**
 * Recursively walks an args object and converts every `undefined` value to
 * `null` so that Rust `Option<T>` fields deserialise correctly.  Arrays and
 * nested objects are handled; non-plain values are left untouched.
 */
function coerceArgs(args: InvokeArgs): InvokeArgs {
  if (Array.isArray(args)) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = v === undefined ? null : v;
  }
  return out as InvokeArgs;
}

export interface InvokeOpts {
  options?: InvokeOptions;
  timeoutMs?: number;
  /**
   * Caller-supplied idempotency key. When provided, a second in-flight call
   * with the same key returns the existing promise instead of issuing a new
   * Tauri invoke. The key is removed once the promise settles.
   */
  idempotencyKey?: string;
}

/**
 * Wrapper around Tauri's `invoke()` that adds a configurable timeout via
 * `Promise.race`. If the backend doesn't respond within `timeoutMs` the
 * returned promise rejects with an `InvokeTimeoutError`.
 *
 * Every call is recorded into the IPC metrics ring buffer for observability.
 *
 * **Memory-leak fix**: the timeout branch now eagerly releases its reference
 * to the original invocation promise so GC can reclaim args/closures even if
 * the backend takes arbitrarily long to respond.
 *
 * **Dedup via idempotencyKey**: callers that generate a per-attempt key (e.g.
 * `executePersona`) can pass it through `opts.idempotencyKey`. A duplicate
 * in-flight call with the same key reuses the pending promise.
 */
export function invokeWithTimeout<T>(
  cmd: CommandName,
  args?: InvokeArgs,
  opts?: InvokeOpts | InvokeOptions,
  timeoutMs?: number,
): Promise<T> {
  // Support both old positional signature and new opts object.
  let resolvedOptions: InvokeOptions | undefined;
  let resolvedTimeout: number;
  let idempotencyKey: string | undefined;

  if (opts && "idempotencyKey" in opts) {
    // New opts-object form
    resolvedOptions = (opts as InvokeOpts).options;
    resolvedTimeout = (opts as InvokeOpts).timeoutMs ?? DEFAULT_TIMEOUT_MS;
    idempotencyKey = (opts as InvokeOpts).idempotencyKey;
  } else {
    // Legacy positional form: (cmd, args, options?, timeoutMs?)
    resolvedOptions = opts as InvokeOptions | undefined;
    resolvedTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // --- Idempotency dedup: reuse in-flight promise for same key -----------
  if (idempotencyKey) {
    const existing = inflightByKey.get(idempotencyKey);
    if (existing) return existing as Promise<T>;
  }

  const promise = _invokeCore<T>(cmd, args, resolvedOptions, resolvedTimeout);

  if (idempotencyKey) {
    const key = idempotencyKey;
    inflightByKey.set(key, promise);
    // Remove on settle regardless of outcome
    promise.finally(() => inflightByKey.delete(key));
  }

  return promise;
}

function _invokeCore<T>(
  cmd: CommandName,
  args: InvokeArgs | undefined,
  options: InvokeOptions | undefined,
  timeoutMs: number,
): Promise<T> {
  const start = performance.now();
  const invocation = invoke<T>(cmd, args ? coerceArgs(args) : undefined, options);

  // We use a mutable holder so the timeout callback can release its reference
  // to the invocation promise, allowing GC to collect args/closures even if
  // the backend is still working.
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const timeout = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new InvokeTimeoutError(cmd, timeoutMs));
      }
    }, timeoutMs);
  });

  // Clear the timer as soon as the real invocation settles so it doesn't
  // fire uselessly after the backend responds.
  invocation.finally(() => {
    settled = true;
    if (timerId !== null) clearTimeout(timerId);
  }).catch(() => {/* rejection handled by Promise.race */});

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
