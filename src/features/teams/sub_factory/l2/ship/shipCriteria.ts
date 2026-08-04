// The exit-criteria REGISTRY. Each criterion is one self-describing entry
// {id, label, derive} in a single table, so adding one is an append here
// rather than surgery inside the derivation loop of a hook.
//
// Every registered criterion is active for every milestone. Per-milestone
// opt-in is deliberately NOT built: it needs a schema column, and a criterion
// a project can switch off is a criterion that stops meaning anything.
//
// `derive` is pure. It sees only the milestone's decisions (core members,
// bound goals, the row) and the signals the Factory already trusts (the
// derived footprint, sensor wiring), and returns the four fields the chip and
// the verdict read. Evidence lines are derived prose, never hand-typed.
import type { Translations } from '@/i18n/generated/types';
import type { DevMilestone } from '@/lib/bindings/DevMilestone';

import type { CritState, ExitCriterion, ShipContext, ShipGoal, ShipMember } from './shipModel';

/** `tx` from useTranslation (or `interpolate` directly in tests). */
export type Interpolator = (template: string, vars: Record<string, string | number>) => string;

export interface CriteriaInput {
  /** The milestone row: `cut_at` is the scope-creep baseline. */
  row: DevMilestone;
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

/** What a criterion computes: everything on ExitCriterion except id + label. */
export interface CriterionDerivation {
  evidence: string;
  done: number;
  total: number;
  state: CritState;
}

export interface CriterionSpec {
  /** Stable identifier. Also the Fleet dispatch key and the ShipDispatch switch. */
  id: string;
  label: (t: Translations) => string;
  derive: (input: CriteriaInput) => CriterionDerivation;
}

/**
 * Order is display order: the chip row in the content header reads down this
 * table. `shipVerdict` folds the states with a fixed precedence and does not
 * care about order.
 */
export const SHIP_CRITERIA: readonly CriterionSpec[] = [
  {
    id: 'contexts',
    label: (t) => t.ship.crit_contexts,
    derive: ({ footprint, t, tx }) => {
      const healthy = footprint.filter((c) => c.tone === 'ok').length;
      const critical = footprint.filter((c) => c.tone === 'crit');
      return {
        evidence: footprint.length === 0
          ? t.ship.crit_contexts_empty
          : tx(t.ship.crit_contexts_evidence, { healthy, total: footprint.length })
            + (critical.length > 0
              ? tx(t.ship.crit_contexts_critical, { names: critical.map((c) => c.name).join(', ') })
              : ''),
        done: healthy,
        total: footprint.length,
        state: footprint.length === 0 ? 'setup'
          : critical.length > 0 ? 'nogo'
          : healthy < footprint.length ? 'warn' : 'go',
      };
    },
  },
  {
    id: 'kpi',
    label: (t) => t.ship.crit_kpi,
    derive: ({ footprint, t, tx }) => {
      const covered = footprint.filter((c) => c.kpis > 0).length;
      return {
        evidence: footprint.length === 0
          ? t.ship.crit_kpi_empty
          : tx(t.ship.crit_kpi_evidence, { covered, total: footprint.length }),
        done: covered,
        total: footprint.length,
        state: footprint.length === 0 ? 'setup' : covered === footprint.length ? 'go' : 'warn',
      };
    },
  },
  {
    id: 'objective',
    label: (t) => t.ship.crit_objective,
    derive: ({ boundGoals, t }) => ({
      evidence: boundGoals.length > 0
        ? boundGoals.map((g) => g.name).join(' · ')
        : t.ship.crit_objective_empty,
      done: boundGoals.length > 0 ? 1 : 0,
      total: 1,
      state: boundGoals.length > 0 ? 'go' : 'setup',
    }),
  },
  {
    id: 'sensors',
    label: (t) => t.ship.crit_sensors,
    derive: ({ monitoringWired, llmWired, t }) => {
      const sensors = (monitoringWired ? 1 : 0) + (llmWired ? 1 : 0);
      return {
        evidence: sensors === 2 ? t.ship.crit_sensors_ok : t.ship.crit_sensors_missing,
        done: sensors,
        total: 2,
        state: sensors === 2 ? 'go' : 'setup',
      };
    },
  },
  {
    // Scope creep is already recorded per member (added_after_cut, derived by
    // the backend against cut_at). This makes it a first-class exit signal:
    // a cut that kept growing after certification is a cut whose criteria
    // were measured against a moving target.
    //
    // `warn`, not `nogo`: growing the scope is a legitimate decision, and the
    // layer's job is to make it legible, not to block it.
    id: 'scope-frozen',
    label: (t) => t.ship.crit_scope,
    derive: ({ core, row, t, tx }) => {
      const crept = core.filter((m) => m.afterCut);
      const total = core.length;
      const done = total - crept.length;
      if (!row.cutAt) {
        // No baseline stamped, so added_after_cut carries no information yet.
        // Saying "frozen" here would be a claim the data cannot support.
        return { evidence: t.ship.crit_scope_uncut, done, total, state: 'setup' };
      }
      if (crept.length === 0) {
        return { evidence: t.ship.crit_scope_clean, done, total, state: 'go' };
      }
      return {
        evidence: tx(t.ship.crit_scope_crept, {
          count: crept.length,
          names: crept.map((m) => m.feature.name).join(', '),
        }),
        done,
        total,
        state: 'warn',
      };
    },
  },
];

/** Run the registry for one milestone. */
export function deriveCriteria(input: CriteriaInput): ExitCriterion[] {
  return SHIP_CRITERIA.map((spec) => ({
    id: spec.id,
    label: spec.label(input.t),
    ...spec.derive(input),
  }));
}
