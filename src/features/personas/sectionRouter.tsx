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
import type { SidebarSection } from '@/lib/types/types';
import { navSection } from '@/lib/navigation/registry';

// Shared Suspense fallback — null (content fades in via the motion wrapper).
const SectionFallback = null;

// Lazy-loaded section primaries. lazyRetry (NOT raw React.lazy): raw lazy caches
// a rejected import promise forever, so one failed chunk fetch bricked the
// section until a full reload — the 2026-06-07 "infinite rendering" incident.
// lazyRetry swaps in a fresh lazy instance after failure so the next
// error-boundary reset / remount re-imports.
export const HomePage = lazyRetry(() => import('@/features/home/components/HomePage'));
export const OverviewPage = lazyRetry(() => import('@/features/overview/components/dashboard/OverviewPage'));
export const TeamCanvas = lazyRetry(() => import('@/features/teams/sub_teamWorkspace/TeamCanvas'));
export const PersonaOverviewPage = lazyRetry(() => import('@/features/agents/components/allPersonas/PersonaOverviewPage'));
export const TriggersPage = lazyRetry(() => import('@/features/triggers/TriggersPage').then(m => ({ default: m.TriggersPage })));
export const CredentialManager = lazyRetry(() => import('@/features/vault/sub_credentials/manager/CredentialManager').then(m => ({ default: m.CredentialManager })));
export const DesignReviewsPage = lazyRetry(() => import('@/features/templates/components/DesignReviewsPage'));
export const PluginBrowsePage = lazyRetry(() => import('@/features/plugins/PluginBrowsePage'));
export const StudioPage = lazyRetry(() => import('@/features/studio/StudioPage'));
export const SettingsPage = lazyRetry(() => import('@/features/settings/components/SettingsPage'));

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
 */
export function renderSectionRoute(section: RoutableSection, onGoHome: () => void): ReactNode {
  const { Component, boundaryName } = SECTION_ROUTES[section];
  return (
    <ErrorBoundary onGoHome={onGoHome} name={boundaryName}>
      <Suspense fallback={SectionFallback}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}

/** Convenience: the registry gates for a routable section (single source of truth). */
export function sectionGates(section: SidebarSection) {
  return navSection(section).gates;
}
