import { useSystemStore } from '@/stores/systemStore';
import type { SidebarSection } from '@/lib/types/types';
import type { CompanionPluginTab } from '@/stores/slices/system/athenaSlice';

/**
 * Mirrors the backend `ALLOWED_ROUTES` allow-list in
 * src-tauri/src/companion/dispatcher.rs. Defensive: the backend already
 * filters `navigate` client actions before they reach the frontend, but a
 * stale frontend or future-protocol mismatch shouldn't throw the sidebar
 * into an unknown state.
 *
 * Single source of truth for the two independent consumers that used to
 * carry their own copy of this list (AthenaChatPanel's proactive-nav guard
 * and useDecisionQueue's approval-nav guard) — see
 * refactor-bughunt-2026-07-10 finding #6.
 */
export const ATHENA_NAV_ROUTES: SidebarSection[] = [
  'home',
  'overview',
  'personas',
  'events',
  'credentials',
  'design-reviews',
  'plugins',
  'schedules',
  'settings',
];

/**
 * Deep-link into the Companion plugin's Setup tab (Plugins > Companion >
 * Setup) — the target for the toolbar's gear icon. Sets the sidebar
 * section, the active plugin, and the companion sub-tab in one call so
 * `AthenaPage` renders `SetupPanel` on the very first frame.
 * Mirrors the `open_companion_tab` deep-link ApprovalCard already uses.
 */
export function navigateToAthenaSetup(): void {
  navigateToAthenaTab('setup');
}

/** Deep-link into Plugins > Companion > Create Athena (the onboarding wizard). */
export function navigateToCreateAthena(): void {
  navigateToAthenaTab('create-athena');
}

/** The one writer both deep-links share: one arrival door onto the plugin surface. */
function navigateToAthenaTab(tab: CompanionPluginTab): void {
  const sys = useSystemStore.getState();
  sys.setSidebarSection('plugins');
  sys.setPluginTab('companion');
  sys.setCompanionPluginTab(tab);
}
