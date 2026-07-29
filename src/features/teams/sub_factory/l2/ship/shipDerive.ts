// The Ship layer's PURE derivations, lifted out of useShipData's useMemo so
// they can be unit-tested without a React tree. Nothing here touches IPC,
// stores or hooks: given the decisions (members, bound goals) and the signals
// (contexts, sensor wiring), it returns the footprint and the exit criteria.
//
// The footprint resolves by context ID, never by display name. Names in the
// auto-generated context map are near-identical by construction
// ("teams/factory [1/3]", "[2/3]") and every rescan can rename a context, so a
// name-keyed join silently drops contexts out of the footprint. That footprint
// feeds two exit criteria and therefore the ship verdict: a milestone could
// read GO because a context quietly vanished from its own scope.
import type { Translations } from '@/i18n/generated/types';

import type { ExitCriterion, ShipContext, ShipGoal, ShipMember } from './shipModel';

/** `tx` from useTranslation (or `interpolate` directly in tests). */
export type Interpolator = (template: string, vars: Record<string, string | number>) => string;

export interface CriteriaInput {
  /** CORE members only. Later/never contribute nothing to the criteria. */
  core: ShipMember[];
  boundGoals: ShipGoal[];
  /** Already resolved via `deriveFootprint`. */
  footprint: ShipContext[];
  monitoringWired: boolean;
  llmWired: boolean;
  t: Translations;
  tx: Interpolator;
}

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

/** The exit criteria for one milestone. Evidence lines are derived prose. */
export function deriveCriteria(input: CriteriaInput): ExitCriterion[] {
  const { boundGoals, footprint, monitoringWired, llmWired, t, tx } = input;
  const healthy = footprint.filter((c) => c.tone === 'ok').length;
  const covered = footprint.filter((c) => c.kpis > 0).length;
  const sensors = (monitoringWired ? 1 : 0) + (llmWired ? 1 : 0);

  return [
    {
      id: 'contexts',
      label: t.ship.crit_contexts,
      evidence: footprint.length === 0
        ? t.ship.crit_contexts_empty
        : tx(t.ship.crit_contexts_evidence, { healthy, total: footprint.length })
          + (footprint.some((c) => c.tone === 'crit')
            ? tx(t.ship.crit_contexts_critical, { names: footprint.filter((c) => c.tone === 'crit').map((c) => c.name).join(', ') })
            : ''),
      done: healthy,
      total: footprint.length,
      state: footprint.length === 0 ? 'setup'
        : footprint.some((c) => c.tone === 'crit') ? 'nogo'
        : healthy < footprint.length ? 'warn' : 'go',
    },
    {
      id: 'kpi',
      label: t.ship.crit_kpi,
      evidence: footprint.length === 0
        ? t.ship.crit_kpi_empty
        : tx(t.ship.crit_kpi_evidence, { covered, total: footprint.length }),
      done: covered,
      total: footprint.length,
      state: footprint.length === 0 ? 'setup' : covered === footprint.length ? 'go' : 'warn',
    },
    {
      id: 'objective',
      label: t.ship.crit_objective,
      evidence: boundGoals.length > 0
        ? boundGoals.map((g) => g.name).join(' · ')
        : t.ship.crit_objective_empty,
      done: boundGoals.length > 0 ? 1 : 0,
      total: 1,
      state: boundGoals.length > 0 ? 'go' : 'setup',
    },
    {
      id: 'sensors',
      label: t.ship.crit_sensors,
      evidence: sensors === 2 ? t.ship.crit_sensors_ok : t.ship.crit_sensors_missing,
      done: sensors,
      total: 2,
      state: sensors === 2 ? 'go' : 'setup',
    },
  ];
}
