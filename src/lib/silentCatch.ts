import * as Sentry from "@sentry/react";
import { log } from "./log";
import { useToastStore } from "@/stores/toastStore";

/** Extract a human-readable message from any error shape (Error, Tauri { error }, or unknown). */
function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "error" in err) return String((err as Record<string, unknown>).error);
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
