import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { HealthBundle } from "@/lib/bindings/HealthBundle";
export type { HealthBundle } from "@/lib/bindings/HealthBundle";
export type { HealthBundleErrors } from "@/lib/bindings/HealthBundleErrors";

// ============================================================================
// Health bundle — one server-side join of the four sources the persona-health
// pipeline needs (monthly spend, bounded healing issues, BYOM policy, provider
// usage stats). Each source is independently fail-able via `bundle.errors`, so
// one failing query degrades a single source instead of nuking the whole view.
// ============================================================================

/**
 * @param healingWindowDays trailing window for the bounded healing scan (default 7)
 * @param healingLimit hard row cap backstop for the healing scan (default 1000)
 */
export const getHealthBundle = (healingWindowDays?: number, healingLimit?: number) =>
  invoke<HealthBundle>("get_health_bundle", {
    healingWindowDays,
    healingLimit,
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
  });
