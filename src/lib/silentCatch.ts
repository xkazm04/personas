import * as Sentry from "@sentry/react";
import { log } from "./log";

/**
 * Returns a `.catch()` handler that logs the error instead of silently
 * swallowing it. Adds a Sentry breadcrumb for post-mortem diagnosis.
 *
 * Usage:  somePromise.catch(silentCatch("gallery:backfillCategories"))
 */
export function silentCatch(context: string): (err: unknown) => void {
  return (err: unknown) => {
    log.warn("silentCatch", `${context} failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    Sentry.addBreadcrumb({
      category: "silentCatch",
      message: `${context} failed: ${err instanceof Error ? err.message : String(err)}`,
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
export function silentCatchNull(context: string): (err: unknown) => null {
  return (err: unknown) => {
    log.warn("silentCatch", `${context} failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    Sentry.addBreadcrumb({
      category: "silentCatch",
      message: `${context} failed: ${err instanceof Error ? err.message : String(err)}`,
      level: "warning",
    });
    return null;
  };
}
