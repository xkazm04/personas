/**
 * Feature-usage analytics — auto-tracks navigation across every UI surface.
 *
 * Subscribes to the app's navigation stores and emits a `feature_visit` event
 * whenever the user changes section or tab. Per-session counts accumulate and
 * a single `session_summary` (visited *and* ignored) flushes on `beforeunload`
 * to keep transport quota predictable.
 *
 * Coverage is driven by the declarative `navCatalog` — adding a tab to the
 * store and listing it in the catalog is all that's needed; there is no
 * hand-maintained section→tab map to drift (the old `TAB_SECTION_MAP` tracked
 * only 6 of ~16 tab dimensions and was blind to non-system stores).
 *
 * Privacy: only section/tab identifier strings are tracked — no user IDs, no
 * persona content, no credentials. All events flow through the active sink,
 * which defaults to Sentry's PII-scrubbed pipeline.
 */
import { getAnalyticsSink } from './sink';
import {
  SYSTEM_TAB_DIMENSIONS,
  OVERVIEW_TAB_DIMENSIONS,
  type TabDimension,
} from './navCatalog';
import { buildSessionSummary, sectionCountKey, tabCountKey } from './summary';

// ---------------------------------------------------------------------------
// Session visit counters (flushed on unload as a single summary event)
// ---------------------------------------------------------------------------

const sessionCounts: Record<string, number> = {};

function bump(key: string): void {
  sessionCounts[key] = (sessionCounts[key] ?? 0) + 1;
}

function emitSectionVisit(section: string): void {
  getAnalyticsSink().feature({ section, action: 'view' });
  bump(sectionCountKey(section));
}

function emitTabVisit(dim: TabDimension, value: string): void {
  getAnalyticsSink().feature({ section: dim.section, tab: value, action: 'tab_switch' });
  bump(tabCountKey(dim.key, value));
}

function flushSessionSummary(): void {
  if (Object.keys(sessionCounts).length === 0) return;
  getAnalyticsSink().session(buildSessionSummary(sessionCounts));
}

// ---------------------------------------------------------------------------
// Navigation subscribers
// ---------------------------------------------------------------------------

type Unsub = () => void;

/**
 * Minimal shape we read off a nav store snapshot. Kept index-signature-free so
 * the concrete store types (SystemStore / OverviewStore) stay assignable to the
 * `StoreSubscribe` parameter; dynamic tab fields are read via `readTab`'s cast.
 */
interface NavState {
  sidebarSection: string;
}

type StoreSubscribe = (listener: (state: NavState, prev: NavState) => void) => Unsub;

function readTab(state: NavState, key: string): string | undefined {
  const v = (state as unknown as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Lazy subscribers for nav stores other than the main system store. Attached
 * the first time their owning section is visited, so we don't eagerly pull
 * (and instantiate) a heavy lazy store at app start. Returns an unsubscribe.
 */
const LAZY_STORE_ATTACHERS: Record<
  string,
  (onTab: (dim: TabDimension, value: string) => void) => Promise<Unsub | void>
> = {
  overview: async (onTab) => {
    const { useOverviewStore } = await import('@/stores/overviewStore');
    const dims = OVERVIEW_TAB_DIMENSIONS;
    // Capture the current tab immediately (the subscribe below only fires on change).
    const cur = useOverviewStore.getState() as unknown as NavState;
    for (const dim of dims) {
      const v = readTab(cur, dim.key);
      if (v) onTab(dim, v);
    }
    return (useOverviewStore.subscribe as unknown as StoreSubscribe)((state, prev) => {
      for (const dim of dims) {
        const c = readTab(state, dim.key);
        const p = readTab(prev, dim.key);
        if (c && c !== p) onTab(dim, c);
      }
    });
  },
};

/**
 * Subscribe to the navigation stores for automatic usage tracking.
 *
 * Pass the system store's `subscribe`. Other stores (overview) are attached
 * lazily on first visit. Call once after telemetry consent is confirmed.
 * Returns an unsubscribe function.
 */
export function initAnalytics(subscribeSystem: StoreSubscribe): Unsub {
  let initialTracked = false;
  const attached = new Set<string>();
  const lazyUnsubs: Unsub[] = [];

  function maybeAttachLazyStore(section: string): void {
    if (attached.has(section)) return;
    attached.add(section);
    const attach = LAZY_STORE_ATTACHERS[section];
    if (!attach) return;
    void attach((dim, value) => emitTabVisit(dim, value))
      .then((unsub) => {
        if (unsub) lazyUnsubs.push(unsub);
      })
      .catch(() => {
        /* store failed to load — skip its tab tracking */
      });
  }

  function handleSection(section: string): void {
    emitSectionVisit(section);
    maybeAttachLazyStore(section);
  }

  const unsubSystem = subscribeSystem((state, prev) => {
    // First callback — track initial page load.
    if (!initialTracked) {
      initialTracked = true;
      handleSection(state.sidebarSection);
    } else if (state.sidebarSection !== prev.sidebarSection) {
      handleSection(state.sidebarSection);
    }

    // Tab changes within system-store sections.
    for (const dim of SYSTEM_TAB_DIMENSIONS) {
      const cur = readTab(state, dim.key);
      const pre = readTab(prev, dim.key);
      if (cur && cur !== pre) emitTabVisit(dim, cur);
    }
  });

  // Flush a session summary on app close.
  window.addEventListener('beforeunload', flushSessionSummary);

  return () => {
    unsubSystem();
    lazyUnsubs.forEach((u) => u());
    window.removeEventListener('beforeunload', flushSessionSummary);
  };
}

// ---------------------------------------------------------------------------
// Re-exports — foundation surface for instrumentation and future backends
// ---------------------------------------------------------------------------

export { trackFeature, trackInteraction } from '../sentry';
export {
  getAnalyticsSink,
  setAnalyticsSink,
  applyTelemetrySink,
  sentrySink,
  noopSink,
  type AnalyticsSink,
  type FeatureVisitEvent,
  type InteractionEvent,
  type SessionSummary,
} from './sink';
export { buildSessionSummary } from './summary';
export { SECTIONS, TAB_DIMENSIONS } from './navCatalog';
export {
  ACTIVATION_FUNNEL,
  type ActivationStep,
  getInstallId,
  markActivation,
  getReachedActivations,
  hasReachedActivation,
  captureReferrerOnce,
  getReferrer,
} from './activation';
