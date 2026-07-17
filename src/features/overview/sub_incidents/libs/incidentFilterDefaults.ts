import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';

/**
 * The inbox's resting state — open-only, no other narrowing. This is both the
 * initial default filter set and what "Clear filters" resets to. Shared by
 * `IncidentsInbox` (initial state / persistence), `IncidentsFilterBar`
 * (clear-filters target), and `IncidentsInboxKpiHeader` (the "Open" KPI tile
 * target/active-check) so the three views can never silently diverge.
 */
export const OPEN_ONLY_FILTERS: IncidentFilters = {
  statuses: ['open'],
  severities: null,
  source_tables: null,
  persona_id: null,
  since: null,
};

/**
 * Whether the given filters have moved past the resting open-only view (see
 * `OPEN_ONLY_FILTERS`). The default (statuses: ['open'], nothing else) is NOT
 * narrowed, so reaching zero results there reads as a healthy "all clear"
 * rather than a no-match result.
 */
export function isNarrowedFilters(filters: IncidentFilters): boolean {
  const statusesAreDefaultOpen =
    !filters.statuses || (filters.statuses.length === 1 && filters.statuses[0] === 'open');
  return (
    !statusesAreDefaultOpen ||
    (filters.severities?.length ?? 0) > 0 ||
    (filters.source_tables?.length ?? 0) > 0 ||
    !!filters.persona_id ||
    !!filters.since
  );
}
