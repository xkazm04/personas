// The Ship layer's PURE scope derivation, lifted out of useShipData's useMemo
// so it can be unit-tested without a React tree. The exit criteria live next
// door in shipCriteria.ts (the registry); this file owns the footprint the
// criteria are computed over.
//
// The footprint resolves by context ID, never by display name. Names in the
// auto-generated context map are near-identical by construction
// ("teams/factory [1/3]", "[2/3]") and every rescan can rename a context, so a
// name-keyed join silently drops contexts out of the footprint. That footprint
// feeds two exit criteria and therefore the ship verdict: a milestone could
// read GO because a context quietly vanished from its own scope.
import type { ShipContext, ShipMember } from './shipModel';

/**
 * The derived context footprint: every context sliced by a CORE member,
 * deduped, resolved BY ID against the project's contexts.
 *
 * Order is first-appearance across the core members, matching the order the
 * cut was composed in.
 */
export function deriveFootprint(core: ShipMember[], contexts: ShipContext[]): ShipContext[] {
  const byId = new Map(contexts.map((c) => [c.id, c]));
  const ids = [...new Set(core.flatMap((mm) => mm.feature.contextIds))];
  return ids
    .map((id) => byId.get(id))
    .filter((c): c is ShipContext => Boolean(c));
}
