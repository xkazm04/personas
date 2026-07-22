import type { BuildPhase } from '@/lib/types/buildTypes';

/**
 * Shared "is this persona currently building" predicate.
 *
 * A persona counts as building when it's the active `buildPersonaId` and the
 * build session has moved past `initializing` (nothing to show yet) and
 * hasn't reached the terminal `promoted` phase.
 *
 * Kept as a plain function (not a hook) so both the page-level `isBuilding`
 * callback (PersonaOverviewPage) and the per-row memo'd card item
 * (PersonaOverviewCardList, which reads buildPersonaId/buildPhase from its
 * own store selector to preserve row-level memoization) can share the exact
 * same definition without one having to take the other as a prop.
 */
export function isPersonaBuilding(
  id: string,
  buildPersonaId: string | null | undefined,
  buildPhase: BuildPhase,
): boolean {
  return id === buildPersonaId && buildPhase !== 'initializing' && buildPhase !== 'promoted';
}
