import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

/**
 * Tauri's canonical "the IPC command isn't registered" error string.
 *
 * Examples:
 *   `Command "list_projects" not found`
 *   `Command list_projects not found.`
 *
 * Anchored at start-of-string and requires the literal `Command ` prefix
 * with a quoted command name token, so it won't accidentally match user-
 * facing not-found errors that just happen to contain the substring.
 */
const TAURI_COMMAND_NOT_FOUND_RE =
  /^Command [^"]*"[\w_]+"[^"]* not found(?:\.|$)/i;

/**
 * True iff `err` is specifically Tauri's "the IPC command isn't registered"
 * failure — i.e. the backend doesn't implement this command yet.
 *
 * ## Historical bug (Wave 5 consolidation, 2026-05-02)
 *
 * Two copies of this function existed: one in `api/researchLab/researchLab.ts`
 * (correctly using a strict regex) and one in `api/devTools/devTools.ts`
 * (still using `msg.includes("not found")`).
 *
 * The substring check matched ANY error containing "not found":
 *   - `"project not found"`
 *   - `"context not found"`
 *   - `"vault path not found"`
 *   - `"host not found"`
 *
 * All of those were silently swallowed as "command missing, return fallback",
 * producing empty-list UIs (e.g. "0 contexts") when the backend was genuinely
 * erroring. This shared file fixes the dev-tools surface to use the same
 * strict-regex check.
 *
 * We now only match on:
 *   1. An AppError-shaped object with `kind === 'not_found'`, or
 *   2. Tauri's canonical `Command "<name>" not found` shape (anchored regex).
 *
 * Substring checks on "not found" are never safe — real resource-not-found
 * errors must propagate, not be coerced into an empty fallback.
 */
export function isCommandNotFound(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'kind' in err) {
    return (err as { kind: string }).kind === 'not_found';
  }
  const msg = typeof err === "string" ? err : err instanceof Error ? err.message
    : typeof err === "object" && err !== null && "error" in err ? String((err as { error: string }).error)
    : String(err);
  return TAURI_COMMAND_NOT_FOUND_RE.test(msg.trim());
}

/**
 * Invoke a Tauri command, returning `fallback` if (and only if) the command
 * isn't registered on the backend (see {@link isCommandNotFound}). Any other
 * error — IPC failures, Rust panics, business-logic "not found" errors — is
 * re-thrown so the caller's error boundary / logger sees it.
 */
export async function safeInvoke<T>(
  fallback: T,
  ...args: Parameters<typeof invoke<T>>
): Promise<T> {
  try {
    return await invoke<T>(...args);
  } catch (err) {
    if (isCommandNotFound(err)) return fallback;
    throw err;
  }
}
