/**
 * Feature usage analytics — auto-tracks navigation and key interactions.
 *
 * Subscribes to the Zustand persona store and fires Sentry feature_visit
 * events when the user navigates between sections or tabs. Also accumulates
 * per-session visit counts and flushes a single session_summary event on
 * beforeunload to keep Sentry quota usage predictable.
 *
 * Privacy: only section/tab name strings are tracked — no user IDs, no
 * persona content, no credentials. All events go through Sentry's existing
 * PII scrubbing pipeline (beforeSend).
 */

import { trackFeature, trackInteraction } from "./sentry";

// ---------------------------------------------------------------------------
// Session visit counters (flushed on unload as a single summary event)
// ---------------------------------------------------------------------------

const sessionCounts: Record<string, number> = {};

function bumpCount(section: string, tab?: string) {
  const key = tab ? `${section}.${tab}` : section;
  sessionCounts[key] = (sessionCounts[key] ?? 0) + 1;
}

function flushSessionSummary() {
  const entries = Object.entries(sessionCounts);
  if (entries.length === 0) return;

  // Lazy import to avoid circular deps at module level
  import("@sentry/react").then((Sentry) => {
    Sentry.withScope((scope) => {
      scope.setTag("event_type", "session_summary");
      scope.setLevel("info");
      // Attach counts as extra data — visible in Sentry event detail
      scope.setExtras(
        Object.fromEntries(entries.map(([k, v]) => [`visit.${k}`, v])),
      );
      const total = entries.reduce((sum, [, v]) => sum + v, 0);
      Sentry.captureMessage(
        `session_summary: ${entries.length} features, ${total} visits`,
        "info",
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Zustand navigation subscriber
// ---------------------------------------------------------------------------

/** Tab state key → which section it belongs to */
const TAB_SECTION_MAP: Record<string, string> = {
  homeTab: "home",
  editorTab: "personas",
  overviewTab: "overview",
  templateTab: "design-reviews",
  cloudTab: "cloud",
  settingsTab: "settings",
};

interface NavigationState {
  sidebarSection: string;
  homeTab: string;
  editorTab: string;
  overviewTab?: string;
  templateTab: string;
  cloudTab: string;
  settingsTab: string;
}

/**
 * Subscribe to the persona store for automatic navigation tracking.
 *
 * Call once after Sentry is initialized. Returns an unsubscribe function.
 */
export function initAnalytics(
  subscribe: (
    listener: (state: NavigationState, prev: NavigationState) => void,
  ) => () => void,
): () => void {
  // Track initial section on app open
  // (deferred to next tick so Sentry init has completed)
  let initialTracked = false;

  const unsub = subscribe((state, prev) => {
    // First callback — track initial page load
    if (!initialTracked) {
      initialTracked = true;
      trackFeature(state.sidebarSection);
      bumpCount(state.sidebarSection);
    }

    // Section change
    if (state.sidebarSection !== prev.sidebarSection) {
      trackFeature(state.sidebarSection);
      bumpCount(state.sidebarSection);
    }

    // Tab changes within sections
    for (const [tabKey, section] of Object.entries(TAB_SECTION_MAP)) {
      const cur = (state as unknown as Record<string, string>)[tabKey];
      const pre = (prev as unknown as Record<string, string>)[tabKey];
      if (cur && cur !== pre) {
        trackFeature(section, cur, "tab_switch");
        bumpCount(section, cur);
      }
    }
  });

  // Flush a session summary on app close
  window.addEventListener("beforeunload", flushSessionSummary);

  return () => {
    unsub();
    window.removeEventListener("beforeunload", flushSessionSummary);
  };
}

// ---------------------------------------------------------------------------
// Manual interaction helpers (re-exported for convenience)
// ---------------------------------------------------------------------------

export { trackFeature, trackInteraction };
