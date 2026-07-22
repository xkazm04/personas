import type { SidebarSection } from '@/lib/types/types';

/**
 * Mirrors the backend `ALLOWED_ROUTES` allow-list in
 * src-tauri/src/companion/dispatcher.rs. Defensive: the backend already
 * filters `navigate` client actions before they reach the frontend, but a
 * stale frontend or future-protocol mismatch shouldn't throw the sidebar
 * into an unknown state.
 *
 * Single source of truth for the two independent consumers that used to
 * carry their own copy of this list (CompanionPanel's proactive-nav guard
 * and useDecisionQueue's approval-nav guard) — see
 * refactor-bughunt-2026-07-10 finding #6.
 */
export const COMPANION_NAV_ROUTES: SidebarSection[] = [
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
