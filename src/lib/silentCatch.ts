import * as Sentry from "@sentry/react";
import { log } from "./log";
import { useToastStore } from "@/stores/toastStore";


/**
 * Extract a human-readable message from any error shape — Error
 * instances, Tauri-style `{ error }` envelopes, structured Tauri
 * rejections (`{ code, message, data }`), plain strings, or unknown.
 *
 * Crucial property: never returns the literal "[object Object]" — that
 * leaks into console.warn / toast strings as opaque noise and is the
 * single most common UX regression in shipped error handling.
 *
 * Exported so callers outside this file can standardize on one helper
 * (zustand slices, store buses, middleware logs, anywhere a rejected
 * promise reason or caught thrown value needs to be rendered as text).
 */
export function extractMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    // Preserve the cause chain in the message — dropping it loses the actual
    // root failure (e.g. "Save failed" with no hint that the cause was a
    // network timeout). One level deep keeps it readable; deeper causes are
    // captured in the stack on the logging path below.
    const cause = (err as { cause?: unknown }).cause;
    if (cause != null && cause !== err) {
      const causeMsg = extractMessage(cause);
      if (causeMsg && causeMsg !== err.message) {
        return `${err.message} (caused by: ${causeMsg})`;
      }
    }
    return err.message;
  }
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    // Common Tauri / API envelope shapes — prefer named text fields
    // before falling through to JSON stringification.
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.error === "string" && obj.error) return obj.error;
    if (typeof obj.detail === "string" && obj.detail) return obj.detail;
    try {
      // JSON.stringify on plain objects produces readable text like
      // {"code":"X","message":"Y"} — far better than "[object Object]".
      const json = JSON.stringify(obj);
      if (json && json !== "{}") return json;
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * The stack trace of an Error, if present — the single most useful piece of
 * post-mortem data, and the thing a bare `err.message` log throws away.
 */
function stackOf(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

/**
 * Returns a `.catch()` handler that logs the error instead of silently
 * swallowing it. Adds a Sentry breadcrumb for post-mortem diagnosis. Preserves
 * the stack trace (in the log payload and the breadcrumb data) so a swallowed
 * failure keeps its post-mortem trail instead of collapsing to one line.
 *
 * Usage:  somePromise.catch(silentCatch("gallery:backfillCategories"))
 */
export function silentCatch(context: string): (err: unknown) => void {
  return (err: unknown) => {
    const msg = extractMessage(err);
    const stack = stackOf(err);
    log.warn("silentCatch", `${context} failed`, { error: msg, stack });
    Sentry.addBreadcrumb({
      category: "silentCatch",
      message: `${context} failed: ${msg}`,
      level: "warning",
      data: stack ? { stack } : undefined,
    });
  };
}

/**
 * Same as silentCatch but returns `null`, for use in Promise.all / data-fetch
 * chains where a fallback value is needed.
 *
 * Usage:  somePromise.catch(silentCatchNull("theater:getTrace"))
 */
/**
 * Like silentCatch but also shows an error toast to the user.
 * Use for operations where the user expects feedback (data fetches, actions).
 *
 * Usage:  somePromise.catch(toastCatch("DeploymentDashboard:fetchDeployments"))
 */
export function toastCatch(context: string, customMessage?: string): (err: unknown) => void {
  return (err: unknown) => {
    const msg = extractMessage(err);
    const stack = stackOf(err);
    log.warn("toastCatch", `${context} failed`, { error: msg, stack });
    Sentry.addBreadcrumb({
      category: "toastCatch",
      message: `${context} failed: ${msg}`,
      level: "warning",
      data: stack ? { stack } : undefined,
    });
    useToastStore.getState().addToast(
      customMessage || `Failed to load data. ${msg}`,
      'error',
      5000,
    );
  };
}

export function silentCatchNull(context: string): (err: unknown) => null {
  return (err: unknown) => {
    const msg = extractMessage(err);
    const stack = stackOf(err);
    log.warn("silentCatch", `${context} failed`, { error: msg, stack });
    Sentry.addBreadcrumb({
      category: "silentCatch",
      message: `${context} failed: ${msg}`,
      level: "warning",
      data: stack ? { stack } : undefined,
    });
    return null;
  };
}
