/**
 * Section content router — the registry-derived mapping from a
 * `SidebarSection` to the primary surface the content area mounts for it.
 *
 * This is the router half of the navigation registry (`@/lib/navigation/registry`).
 * `SECTION_ROUTES` is keyed by `Exclude<SidebarSection, 'schedules'>`, so `tsc`
 * fails if a new rail section is added without a route — and the completeness
 * test asserts the map lines up with `NAV_SECTIONS` in both directions.
 *
 * `schedules` is intentionally absent: it is an `overlay-only` section
 * (summoned via the title-bar tray → `headerOverlay==='schedules'`), so it owns
 * no content-router branch.
 *
 * Only the per-section PRIMARY surfaces live here. Sub-tab surfaces (cloud
 * panels, the teams KPIs/Factory/Goals tabs, the plugin sub-pages, the persona
 * editor / build / create flows) stay in `PersonasPage`, which composes them
 * around these primaries.
 */
import { Suspense, type ComponentType, type ReactNode } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { SECTION_CHUNKS } from '@/features/shared/chrome/navPrefetch';
import type { SidebarSection } from '@/lib/types/types';
import { navSection, passesGates, type GateContext } from '@/lib/navigation/registry';

// Lazy-loaded section primaries, built from the same import thunks the shell
// prefetches (`navPrefetch.ts`), so a warmed chunk is exactly the chunk mounted.
// lazyRetry (NOT raw React.lazy): it retries a failed import once, then keeps
// ONE stable lazy instance so a permanent failure reaches the nearest
// ErrorBoundary and its "Reload app" cure instead of re-suspending forever
// (see the lazyRetry docstring for why swapping in a fresh instance looped).
export const HomePage = lazyRetry(SECTION_CHUNKS.home);
export const OverviewPage = lazyRetry(SECTION_CHUNKS.overview);
export const TeamCanvas = lazyRetry(SECTION_CHUNKS.teams);
export const PersonaOverviewPage = lazyRetry(SECTION_CHUNKS.personas);
export const TriggersPage = lazyRetry(() => SECTION_CHUNKS.events().then(m => ({ default: m.TriggersPage })));
export const CredentialManager = lazyRetry(() => SECTION_CHUNKS.credentials().then(m => ({ default: m.CredentialManager })));
export const DesignReviewsPage = lazyRetry(SECTION_CHUNKS['design-reviews']);
export const PluginBrowsePage = lazyRetry(SECTION_CHUNKS.plugins);
export const CompanionsPage = lazyRetry(SECTION_CHUNKS.companions);
export const StudioPage = lazyRetry(SECTION_CHUNKS.studio);
export const SettingsPage = lazyRetry(SECTION_CHUNKS.settings);

/** A content-routable section id (everything except the overlay-only Schedules). */
export type RoutableSection = Exclude<SidebarSection, 'schedules'>;

export interface SectionRoute {
  /** The primary lazy component mounted for this section. */
  Component: ComponentType;
  /** The `ErrorBoundary` name (preserved verbatim from the pre-registry ladder). */
  boundaryName: string;
}

/**
 * Registry-derived content router. Every rail section maps to its primary
 * surface; the `satisfies` guard fails the typecheck if a section is missing
 * or an overlay-only section sneaks in.
 */
export const SECTION_ROUTES = {
  home:             { Component: HomePage,            boundaryName: 'Home' },
  overview:         { Component: OverviewPage,        boundaryName: 'Overview' },
  teams:            { Component: TeamCanvas,          boundaryName: 'Teams' },
  personas:         { Component: PersonaOverviewPage, boundaryName: 'Agent Overview' },
  events:           { Component: TriggersPage,        boundaryName: 'Triggers' },
  credentials:      { Component: CredentialManager,   boundaryName: 'Vault' },
  'design-reviews': { Component: DesignReviewsPage,   boundaryName: 'Design Reviews' },
  plugins:          { Component: PluginBrowsePage,    boundaryName: 'PluginBrowse' },
  companions:       { Component: CompanionsPage,      boundaryName: 'Companions' },
  studio:           { Component: StudioPage,          boundaryName: 'Studio' },
  settings:         { Component: SettingsPage,        boundaryName: 'Settings' },
} as const satisfies Record<RoutableSection, SectionRoute>;

/** True when a section has a content-router primary (i.e. is not overlay-only). */
export function isRoutableSection(id: SidebarSection): id is RoutableSection {
  return id in SECTION_ROUTES;
}

/**
 * Mount a section's primary surface, wrapped exactly as the pre-registry ladder
 * did: `ErrorBoundary(name) → Suspense → <Component />`.
 *
 * The Suspense fallback defaults to `RouteChunkSkeleton`: invisible for the
 * first 150ms (pure CSS delay), so a warm or prefetched chunk never paints it,
 * and a genuinely slow chunk shows the calm header ghost instead of a blank,
 * collapsed content area. It used to default to `null` on the claim that a
 * motion wrapper faded content in; that wrapper is disabled in `PersonasPage`,
 * so a cold chunk showed nothing at all. `fallback` still overrides it.
 */
export function renderSectionRoute(
  section: RoutableSection,
  onGoHome: () => void,
  fallback: ReactNode = <RouteChunkSkeleton />,
): ReactNode {
  const { Component, boundaryName } = SECTION_ROUTES[section];
  return (
    <ErrorBoundary onGoHome={onGoHome} name={boundaryName}>
      <Suspense fallback={fallback}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}

/** Convenience: the registry gates for a routable section (single source of truth). */
export function sectionGates(section: SidebarSection) {
  return navSection(section).gates;
}

/**
 * Whether a section is blocked by its registry gates for the given context.
 * The content router uses this to fail a forbidden section straight to Home —
 * uniform with the sidebar rail and command palette — instead of briefly
 * mounting a gated surface before the Sidebar redirect effect catches up.
 */
export function isSectionGated(section: SidebarSection, ctx: GateContext): boolean {
  return !passesGates(navSection(section).gates, ctx);
}
