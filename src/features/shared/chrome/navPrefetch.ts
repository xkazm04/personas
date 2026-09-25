/**
 * Shell navigation prefetch: one import thunk per routable section primary,
 * shared by every surface that can predict the next section.
 *
 * - `sectionRouter.tsx` builds its lazy primaries from `SECTION_CHUNKS`, so the
 *   prefetch map and the router cannot drift apart (the Home-only map this
 *   replaced had silently lost Home, Teams, Companions and Studio).
 * - Expressed intent: the main rail (`SidebarLevel1`) calls
 *   `prefetchSectionOnIntent` on hover and focus, and `cancelSectionIntent` when
 *   the pointer or focus leaves; Home's navigation cards call `prefetchSection`
 *   directly (a pointer resting on a large card is already a settled intent).
 * - Idle warm-up: `PersonasPage` drains `prefetchSection` thunks through
 *   `idlePrefetch` after the first data wave.
 *
 * Dedupe: the first call per section stores its import promise in `inFlight`
 * and every later call returns that same promise, so hover, unhover, hover
 * again and the idle drain together cost one `import()`. The key space is the
 * closed `RoutableSectionId` union (11 entries), so the record is bounded by
 * construction. A failed prefetch drops its entry so the next intent retries;
 * the failure is logged, never shown (the click path owns user-facing errors).
 */
import type { SidebarSection } from '@/lib/types/types';
import { silentCatch } from '@/lib/silentCatch';

/** Every rail section except the overlay-only Schedules. */
export type RoutableSectionId = Exclude<SidebarSection, 'schedules'>;

/**
 * The lazy chunk behind each section's primary surface. `satisfies` makes tsc
 * fail when a routable section is added without a chunk here.
 */
export const SECTION_CHUNKS = {
  home: () => import('@/features/home/components/HomePage'),
  overview: () => import('@/features/overview/components/dashboard/OverviewPage'),
  teams: () => import('@/features/teams/sub_teamWorkspace/TeamCanvas'),
  personas: () => import('@/features/agents/components/allPersonas/PersonaOverviewPage'),
  events: () => import('@/features/triggers/TriggersPage'),
  credentials: () => import('@/features/vault/sub_credentials/manager/CredentialManager'),
  'design-reviews': () => import('@/features/templates/components/DesignReviewsPage'),
  plugins: () => import('@/features/plugins/PluginBrowsePage'),
  companions: () => import('@/features/companions/CompanionsPage'),
  studio: () => import('@/features/studio/StudioPage'),
  settings: () => import('@/features/settings/components/SettingsPage'),
} as const satisfies Record<RoutableSectionId, () => Promise<unknown>>;

/** Pointer or focus must rest this long on a nav entry before it counts as intent. */
export const NAV_INTENT_DELAY_MS = 100;

const inFlight: Partial<Record<RoutableSectionId, Promise<unknown>>> = {};
let intentTimer: ReturnType<typeof setTimeout> | null = null;

function hasChunk(id: string): id is RoutableSectionId {
  return Object.prototype.hasOwnProperty.call(SECTION_CHUNKS, id);
}

/**
 * Start loading a section's primary chunk now. Idempotent per section; returns
 * the shared promise, or `undefined` for an id with no chunk (e.g. Schedules).
 */
export function prefetchSection(id: string): Promise<unknown> | undefined {
  if (!hasChunk(id)) return undefined;
  const existing = inFlight[id];
  if (existing) return existing;
  const pending = SECTION_CHUNKS[id]().catch((err: unknown) => {
    delete inFlight[id];
    silentCatch('navPrefetch:sectionChunk')(err);
  });
  inFlight[id] = pending;
  return pending;
}

/**
 * Prefetch after the pointer or focus has rested on a nav entry for
 * {@link NAV_INTENT_DELAY_MS}. A pointer sweeping across the rail replaces the
 * pending intent at each entry, so crossing ten entries fetches at most the one
 * it stops on. A section already loaded or in flight schedules nothing.
 */
export function prefetchSectionOnIntent(id: string): void {
  cancelSectionIntent();
  if (!hasChunk(id) || inFlight[id]) return;
  intentTimer = setTimeout(() => {
    intentTimer = null;
    void prefetchSection(id);
  }, NAV_INTENT_DELAY_MS);
}

/** Drop a pending intent (pointer left, focus moved) before it fires. */
export function cancelSectionIntent(): void {
  if (intentTimer !== null) {
    clearTimeout(intentTimer);
    intentTimer = null;
  }
}

/** Test-only: forget every in-flight entry and pending intent. */
export function __resetNavPrefetchForTests(): void {
  cancelSectionIntent();
  for (const key of Object.keys(inFlight) as RoutableSectionId[]) delete inFlight[key];
}
