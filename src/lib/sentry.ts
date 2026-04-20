import * as Sentry from "@sentry/react";

// ---------------------------------------------------------------------------
// PII patterns to scrub from messages
// ---------------------------------------------------------------------------

/** UUIDs: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx -> [id:a1b2c3] */
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** Full URLs -> domain-only */
const URL_RE = /https?:\/\/[^\s,)}\]]+/g;

/** Quoted strings that may contain user-generated content */
const QUOTED_RE = /'[^']{1,200}'|"[^"]{1,200}"/g;

function scrubPii(input: string): string {
  return input
    .replace(UUID_RE, (match) => `[id:${match.slice(0, 6)}]`)
    .replace(URL_RE, (match) => {
      try {
        const u = new URL(match);
        return `${u.protocol}//${u.host}/...`;
      } catch {
        return '[redacted-url]';
      }
    })
    .replace(QUOTED_RE, '[redacted]');
}

/**
 * Initialize Sentry for error-only monitoring.
 *
 * Called once before ReactDOM.createRoot. If VITE_SENTRY_DSN is not set
 * (local dev), the SDK initializes with no DSN and silently discards all events.
 *
 * Privacy: no performance monitoring, no session replay, no user tracking.
 * Session tracking is enabled for Release Health (active user counts).
 * beforeSend strips PII (IPs, emails, UUIDs, URLs, quoted names) from events.
 */
// ---------------------------------------------------------------------------
// Feature usage tracking via Sentry events
// ---------------------------------------------------------------------------

/** Deduplication window: ignore repeated identical events within this period. */
const DEDUP_MS = 5_000;

/** Sample rate for feature events (0--1). Adjust based on Sentry plan quota. */
const FEATURE_SAMPLE_RATE = 1.0;

let _lastFeatureKey = "";
let _lastFeatureTime = 0;

/**
 * Track a feature/section visit as a Sentry event.
 *
 * Creates a `feature_visit` message with structured tags for Sentry Discover.
 * Deduplicates rapid repeated visits (e.g. tab bouncing within 5 s).
 * Respects FEATURE_SAMPLE_RATE for quota control.
 *
 * No PII: only section/tab/action strings are sent.
 */
export function trackFeature(
  section: string,
  tab?: string,
  action: string = "view",
): void {
  const key = `${section}:${tab ?? ""}:${action}`;
  const now = Date.now();
  if (key === _lastFeatureKey && now - _lastFeatureTime < DEDUP_MS) return;
  if (FEATURE_SAMPLE_RATE < 1 && Math.random() > FEATURE_SAMPLE_RATE) return;

  _lastFeatureKey = key;
  _lastFeatureTime = now;

  Sentry.withScope((scope) => {
    scope.setTag("event_type", "feature_visit");
    scope.setTag("feature.section", section);
    if (tab) scope.setTag("feature.tab", tab);
    scope.setTag("feature.action", action);
    scope.setLevel("info");
    Sentry.captureMessage(`feature_visit: ${section}${tab ? `.${tab}` : ""}`, "info");
  });
}

/**
 * Track a discrete user interaction (button click, wizard step, etc.).
 *
 * Lighter weight than trackFeature -- intended for key actions, not every click.
 */
export function trackInteraction(
  category: string,
  action: string,
  label?: string,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("event_type", "interaction");
    scope.setTag("ix.category", category);
    scope.setTag("ix.action", action);
    if (label) scope.setTag("ix.label", label);
    scope.setLevel("info");
    Sentry.captureMessage(`interaction: ${category}.${action}`, "info");
  });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initSentry(appVersion: string): void {
  // Only report from production builds (installer packages). In dev, VITE_SENTRY_DSN
  // may leak in from a local .env file — ignore it so local errors never ship.
  // See docs/devops/guide-error-reporting.md.
  const dsn = import.meta.env.PROD
    ? (import.meta.env.VITE_SENTRY_DSN as string | undefined)
    : undefined;

  Sentry.init({
    dsn: dsn || undefined,
    release: appVersion,
    environment: import.meta.env.MODE,

    // Errors only -- no performance, no replay
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Session tracking for Release Health (active user counts per version)
    // is enabled by default in @sentry/react v10. Uses anonymous device IDs.

    sendDefaultPii: false,

    beforeSend(event) {
      // Drop Vite HMR client's own send-before-connect race — dev-only noise, never our bug
      const excValue = event.exception?.values?.[0]?.value ?? event.message ?? '';
      if (typeof excValue === 'string' && excValue.includes('send was called before connect')) {
        return null;
      }
      // Strip user fields
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      // Strip request headers and body
      if (event.request) {
        delete event.request.headers;
        delete event.request.data;
      }
      // Scrub PII from the event message
      if (event.message) {
        event.message = scrubPii(event.message);
      }
      // Scrub PII from exception values
      if (event.exception?.values) {
        for (const exc of event.exception.values) {
          if (exc.value) {
            exc.value = scrubPii(exc.value);
          }
        }
      }
      // Scrub PII from breadcrumbs attached to the event
      if (event.breadcrumbs) {
        for (const bc of event.breadcrumbs) {
          if (bc.message) {
            bc.message = scrubPii(bc.message);
          }
        }
      }
      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.message) {
        breadcrumb.message = scrubPii(breadcrumb.message);
      }
      return breadcrumb;
    },
  });
}
