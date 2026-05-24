/** Shared grid class tokens for all dashboard views.
 *  Keeps visual rhythm consistent across Home, Analytics, and Executions subtabs. */

/** Standard breakpoint-aware grid for chart panels. */
export const DASHBOARD_GRID = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';

/** Grid for stat / summary cards (compact 2-up on mobile, 4-up on md+). */
export const SUMMARY_GRID = 'grid grid-cols-2 md:grid-cols-4 gap-3';

/** Column span for the "major" child inside DASHBOARD_GRID (e.g. RecentActivityList). */
export const DASHBOARD_GRID_SPAN_MAJOR = 'md:col-span-1 xl:col-span-2';

/** Shared chrome token for all widget card containers.
 *  Ensures consistent border, background, and shadow across the dashboard. */
export const CARD_CONTAINER = 'rounded-modal border border-primary/12 bg-secondary/30 shadow-elevation-1';
