/**
 * Telemetry preference — controls whether Sentry error reporting and
 * anonymous feature analytics are active.
 *
 * Stored in localStorage so it survives restarts. Defaults to true
 * (opted-in) when the user accepts the consent modal with the telemetry
 * checkbox checked. Can be toggled later in Settings > Account.
 */

const TELEMETRY_KEY = "__personas_telemetry_enabled";

/** Read the current preference. Returns true when not explicitly disabled. */
export function isTelemetryEnabled(): boolean {
  try {
    return localStorage.getItem(TELEMETRY_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Persist the preference. */
export function setTelemetryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(TELEMETRY_KEY, enabled ? "true" : "false");
  } catch {
    // no-op if localStorage unavailable
  }
}
