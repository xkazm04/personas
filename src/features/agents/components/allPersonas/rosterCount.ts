import type { Persona } from '@/lib/bindings/Persona';

/**
 * The lifecycle population a roster view lists: the Archived view lists only
 * archived personas, every other view lists only the rest. The filter pipeline
 * (`usePersonaListFilters`), the team rail's counts and the header total all
 * count over this one population, so the header cannot call an unfiltered
 * roster "10 of 12" because 2 archived personas sit outside it.
 */
export function inLifecyclePopulation(p: Persona, archivedView: boolean): boolean {
  return (p.lifecycle === 'archived') === archivedView;
}

export type RosterCount =
  | { kind: 'all'; count: number }
  | { kind: 'filtered'; shown: number; total: number };

/** The header count: "N personas", or "shown of total" only when a filter
 *  (search, status, health, connector, favorites, team) narrows the view. */
export function rosterCount(personas: Persona[], shown: number, archivedView: boolean): RosterCount {
  let total = 0;
  for (const p of personas) if (inLifecyclePopulation(p, archivedView)) total += 1;
  return shown === total ? { kind: 'all', count: total } : { kind: 'filtered', shown, total };
}
