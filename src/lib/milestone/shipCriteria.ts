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

/** One skill and the contexts it has reached with fresh insight. */
export interface SkillCoverage {
  /** Skill name as attributed in `memory_nodes.source` (`skill:<name>`). */
  skill: string;
  contextIds: Set<string>;
}

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
  /**
   * Project-wide (skill → contexts) coverage, 30-day window. Empty means no
   * skill has run here yet, which the criterion reports as `setup` — an
   * unmeasured surface, not a failing one.
   */
  skillCoverage: SkillCoverage[];
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
  {
    // SKILL COVERAGE — "has anything been learned, recently, about the code this
    // milestone touches?"
    //
    // The operator's framing (2026-08-25) was per-skill: "/perfect or
    // /scan-sweep with 100% coverage". The GATE here is deliberately the
    // aggregate — a footprint context counts as covered when ANY skill has left
    // fresh insight on it — and the per-skill reading rides in the evidence
    // line. Two reasons, both about the gate meaning something:
    //
    //   * The registry's own rule (top of this file) is that every criterion is
    //     active for every milestone and per-milestone opt-in is not built. A
    //     per-skill gate needs a declared skill set to be a gate at all, and
    //     "every skill that ever ran here" is not that: one skill run once on
    //     one context would hold every milestone at ~0% forever.
    //   * Coverage is DISTINCT contexts, never node counts. A context with
    //     forty nodes from one skill is no more covered than one with a single
    //     node, and counting would invite a threshold nobody has measured.
    //
    // The footprint is the denominator, not the whole project: this asks about
    // the code the CUT touches. A milestone whose cut is all goals has no
    // footprint and honestly reports that it has nothing to measure.
    id: 'skill-coverage',
    label: (t) => t.ship.crit_skill_coverage,
    derive: ({ footprint, skillCoverage, t, tx }) => {
      if (footprint.length === 0) {
        return { evidence: t.ship.crit_skill_coverage_empty, done: 0, total: 0, state: 'setup' };
      }
      if (skillCoverage.length === 0) {
        // No skill has run on this project inside the freshness window. That is
        // an UNMEASURED surface, not a failing one — `setup`, the same state the
        // other criteria use for "no sensor wired yet".
        return {
          evidence: t.ship.crit_skill_coverage_none,
          done: 0,
          total: footprint.length,
          state: 'setup',
        };
      }
      const ids = footprint.map((c) => c.id);
      const covered = ids.filter((id) => skillCoverage.some((s) => s.contextIds.has(id)));
      // The per-skill reading the operator asked for — each skill measured
      // against THIS milestone's footprint, worst-covered last so the gap is
      // what the line ends on.
      const perSkill = skillCoverage
        .map((s) => ({ skill: s.skill, n: ids.filter((id) => s.contextIds.has(id)).length }))
        .filter((x) => x.n > 0)
        .map((x) => tx(t.ship.crit_skill_coverage_per_skill, {
          skill: x.skill,
          n: x.n,
          total: footprint.length,
        }));
      const uncovered = footprint.filter((c) => !skillCoverage.some((s) => s.contextIds.has(c.id)));
      return {
        evidence: tx(t.ship.crit_skill_coverage_evidence, {
          covered: covered.length,
          total: footprint.length,
          skills: perSkill.join(' · '),
        }) + (uncovered.length > 0
          ? tx(t.ship.crit_skill_coverage_uncovered, { names: uncovered.map((c) => c.name).join(', ') })
          : ''),
        done: covered.length,
        total: footprint.length,
        state: covered.length === footprint.length ? 'go' : 'warn',
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
