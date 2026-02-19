import * as Sentry from "@sentry/react";

/**
 * Initialize Sentry for error-only monitoring.
 *
 * Called once before ReactDOM.createRoot. If VITE_SENTRY_DSN is not set
 * (local dev), the SDK initializes with no DSN and silently discards all events.
 *
 * Privacy: no performance monitoring, no session replay, no user tracking.
 * Session tracking is enabled for Release Health (active user counts).
 * beforeSend strips IP, email, and request bodies from every event.
 */
export function initSentry(appVersion: string): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

  Sentry.init({
    dsn: dsn || undefined,
    release: appVersion,
    environment: import.meta.env.MODE,

    // Errors only — no performance, no replay
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Session tracking for Release Health (active user counts per version)
    // is enabled by default in @sentry/react v10. Uses anonymous device IDs.

    sendDefaultPii: false,

    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      if (event.request) {
        delete event.request.headers;
        delete event.request.data;
      }
      return event;
    },
  });
}
