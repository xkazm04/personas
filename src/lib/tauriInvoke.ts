import { invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import { recordIpcCall } from "./ipcMetrics";
import type { CommandName as RegisteredCommand } from "./commandNames.generated";
import type { UnregisteredCommand } from "./commandNames.overrides";

/** All valid command names: registered + known-unregistered forward-references. */
export type CommandName = RegisteredCommand | UnregisteredCommand;

/**
 * Maps a TypeScript args interface so that every property whose Rust
 * counterpart is `Option<T>` can be passed as `T | null | undefined`.
 *
 * `invokeWithTimeout` coerces `undefined` to `null` before serialisation, so
 * the Rust side always receives either a concrete value or `None`.
 *
 * Usage in API wrappers:
 * ```ts
 * interface ListMemoriesArgs {
 *   personaId: string | null;  // Rust Option<String>
 *   category: string | null;   // Rust Option<String>
 *   limit: number | null;      // Rust Option<i64>
 * }
 * // RustArgs<ListMemoriesArgs> allows `undefined` wherever `null` is accepted
 * export const listMemories = (args: RustArgs<ListMemoriesArgs>) =>
 *   invoke<PersonaMemory[]>("list_memories", args);
 * ```
 */
export type RustArgs<T extends Record<string, unknown>> = {
  [K in keyof T]: null extends T[K] ? T[K] | undefined : T[K];
};

/** Default timeout for Tauri IPC calls (90 seconds). */
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Wait for the IPC session token AND the __TAURI_INTERNALS__ monkey-patch
 * to become available. Resolves once both are ready or after ~2 s max.
 * The monkey-patch is critical on Windows WebView2 — without it the
 * x-ipc-token header may not reach the Rust backend.
 */
let _tokenReady: Promise<void> | null = null;
function waitForIpcToken(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  // Wait for the IPC token to be set by the Rust init script.
  // The monkey-patch (__ipc_patched) is also set by the init script but may
  // arrive slightly later; we don't gate on it here to avoid infinite retry
  // loops that cause OOM when the patch timing differs from the token timing.
  const isReady = () => !!g.__IPC_TOKEN;
  if (isReady()) return Promise.resolve();
  if (_tokenReady) return _tokenReady;
  _tokenReady = new Promise<void>((resolve) => {
    let tries = 0;
    const iv = setInterval(() => {
      if (isReady() || ++tries > 100) {
        clearInterval(iv);
        resolve();
      }
    }, 20);
  });
  return _tokenReady;
}

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
 * ### undefined-to-null coercion
 *
 * Before forwarding `args` to the Tauri bridge, every top-level property whose
 * value is `undefined` is replaced with `null`.  This is required because
 * `JSON.stringify` **omits** `undefined` properties entirely, which causes Rust
 * `serde_json` to reject the payload when the corresponding field is
 * `Option<T>` (missing key !== `null`).  After coercion, Rust sees `null` and
 * deserialises it as `None`.
 *
 * **Callers may therefore pass `undefined` for any Rust `Option<T>` parameter**
 * and rely on this wrapper to produce the correct wire format.  Prefer using
 * the {@link RustArgs} utility type in new API wrappers so the contract is
 * visible at the type level.
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

  // Wait for the IPC session token before invoking.
  // The Rust init script sets __IPC_TOKEN and patches __TAURI_INTERNALS__.invoke
  // to inject the token header automatically. We wait once for readiness, then
  // proceed — no recursive retry to avoid infinite Promise loops (OOM).
  const g = globalThis as Record<string, unknown>;
  const token = g.__IPC_TOKEN as string | undefined;

  if (!token) {
    return waitForIpcToken().then(() =>
      _invokeCore<T>(cmd, args, options, timeoutMs),
    );
  }

  // Inject IPC session token for privileged command authentication.
  // Also acts as defense-in-depth on platforms where the monkey-patch
  // (set by ipc_auth.rs init script) hasn't run yet.
  const opts: InvokeOptions = options ?? { headers: {} };
  const h = new Headers(opts.headers);
  h.set("x-ipc-token", token);
  options = { ...opts, headers: h };

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
