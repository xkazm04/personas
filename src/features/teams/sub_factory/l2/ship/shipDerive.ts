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
import { isComplete } from '@/features/teams/sub_goals/goalStatus';

import type { ShipContext, ShipGoal, ShipMember } from './shipModel';

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

/**
 * Everything (features or goals) that slices ONE context, resolved by context
 * ID.
 *
 * The library tree and the context drawer used to filter on
 * `item.contexts.includes(ctx.name)` — the exact name-join this module was
 * rewritten to avoid. Two contexts that share a display name ("area [1/3]" and
 * "area [2/3]" collapse to "area" often enough in the generated map) made each
 * one list the OTHER's features, so the operator cut scope under the wrong
 * band. One helper, used by both surfaces, keeps that fixed in one place.
 */
export function inContext<T extends { contextIds: string[] }>(items: T[], contextId: string): T[] {
  return items.filter((i) => i.contextIds.includes(contextId));
}

/**
 * The milestone's progress percentage over its CORE cut.
 *
 * **Goals count, and until 2026-08-25 they did not.** This read
 * `ready core FEATURES / total core features`, so a milestone whose cut was
 * five goals and zero features reported 0% forever — and that is exactly the
 * shape a milestone takes when its brief has just been decomposed into goals
 * (`show_ship_goals`), before any of it exists as a use case. A number that
 * cannot move is not a progress number.
 *
 * Both member kinds contribute one unit each, and each is "done" by its own
 * reading, because they are genuinely different measurements:
 *
 *   - a FEATURE is done when the AUTOMATION says so (`feature.ready` —
 *     measurable by ≥1 KPI and no critical context in its slice). Nobody types
 *     it, which is the whole point of the layer.
 *   - a GOAL is done when its `dev_goals.status` says so, through
 *     `isComplete` — the shared normalizer, so `done` / `completed` /
 *     `complete` / `skipped` all read the same here as they do in the Goals
 *     hub and in the Rust `normalize_goal_status` mirror. Comparing the raw
 *     string is what mis-laned every in-progress goal in the Goals module v1.
 *
 * Operator RATINGS still contribute nothing — that is `deriveDuality`'s
 * subject, and wiring a second opinion into progress was rejected in design.
 * An empty cut is 0, not 100: a milestone with nothing in it has not finished
 * anything.
 */
export function deriveProgress(core: ShipMember[], coreGoals: ShipGoal[]): number {
  const { done, total } = deriveCutTally(core, coreGoals);
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

/**
 * The cut's size and how much of it is done — the counts `deriveProgress`
 * folds into a percentage, exposed because the ledger header shows them as a
 * fraction rather than a percent.
 *
 * It exists so those two readings cannot disagree. The header used to count
 * `core.length` in the component while progress counted core + goals in here;
 * the same cut then read "2 of 3" beside a 40% bar, and nothing connected them.
 */
export function deriveCutTally(core: ShipMember[], coreGoals: ShipGoal[]): { done: number; total: number } {
  return {
    done:
      core.filter((m) => m.feature.ready).length +
      coreGoals.filter((g) => isComplete(g.status)).length,
    total: core.length + coreGoals.length,
  };
}
