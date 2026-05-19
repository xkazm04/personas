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
  if (err instanceof Error) return err.message;
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
      // Cyclic structure — fall through to String().
    }
  }
  return String(err);
}

/**
 * Returns a `.catch()` handler that logs the error instead of silently
 * swallowing it. Adds a Sentry breadcrumb for post-mortem diagnosis.
 *
 * Usage:  somePromise.catch(silentCatch("gallery:backfillCategories"))
 */
export function silentCatch(context: string): (err: unknown) => void {
  return (err: unknown) => {
    const msg = extractMessage(err);
    log.warn("silentCatch", `${context} failed`, { error: msg });
    Sentry.addBreadcrumb({
      category: "silentCatch",
      message: `${context} failed: ${msg}`,
      level: "warning",
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
    log.warn("toastCatch", `${context} failed`, { error: msg });
    Sentry.addBreadcrumb({
      category: "toastCatch",
      message: `${context} failed: ${msg}`,
      level: "warning",
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
    log.warn("silentCatch", `${context} failed`, { error: msg });
    Sentry.addBreadcrumb({
      category: "silentCatch",
      message: `${context} failed: ${msg}`,
      level: "warning",
    });
    return null;
  };
}
