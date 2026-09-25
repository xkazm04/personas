import { navigateToCompanions } from '@/features/companions/navigation';
import type { CompanionsPage } from '@/features/companions/types';
import type { SidebarSection } from '@/lib/types/types';

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
  'companions',
  'schedules',
  'settings',
];

/**
 * Deep-link into Companions > Athena > Setup — the target for the toolbar's
 * gear icon. One call lands the section and the page together, so `AthenaPage`
 * renders `SetupPanel` on the very first frame. Mirrors the
 * `open_companion_tab` deep-link ApprovalCard already uses.
 */
export function navigateToAthenaSetup(): void {
  navigateToAthenaTab('athena:setup');
}

/** Deep-link into Companions > Athena > Create Athena (the onboarding wizard). */
export function navigateToCreateAthena(): void {
  navigateToAthenaTab('athena:create-athena');
}

/** The one writer both deep-links share: the category's single arrival door. */
function navigateToAthenaTab(page: CompanionsPage): void {
  navigateToCompanions(page);
}
