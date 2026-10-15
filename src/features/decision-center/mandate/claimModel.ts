/**
 * claimModel — the Accept card for a goal claim (`goal:<id>` awaiting
 * acceptance): its met-when checklist and the audit sample. React-free.
 *
 * Met-when: the goal's own conditions (`dev_goals.met_when`, read through
 * `goal_met_when`). Each named condition is one row, and each row says only
 * what is known: the KPI is checked against its target from the acceptance
 * row the card already carries (when the condition names that same KPI); the
 * UAT and the council round are listed as conditions with no tick, because
 * nothing here records a UAT pass or links a council verdict to a goal. A
 * goal that names no condition says so in one line (never an empty list), and
 * a read that failed or text that could not be parsed says that instead.
 *
 * Audit sample: a few of the mandate's acts picked at random, so the operator
 * judges the steward's work by spot check rather than by its own summary. The
 * pick is seeded by the card (the same card shows the same sample while it is
 * open, so a key never jumps to another row), and envelope acts are left out:
 * the sample is about decisions taken, not about the envelope itself.
 */
import type { TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { GoalMetWhen } from '@/lib/bindings/GoalMetWhen';

import type { Interpolate, MonitorCopy } from '../deck/deckMeta';
import type { DecisionItem } from '../model/decisionModel';

export interface MetCheck {
  tone: TriageTone;
  text: string;
}

export function kpiCheck(item: DecisionItem, m: MonitorCopy, tx: Interpolate): MetCheck {
  const kpi = item.facts.find((f) => f.id === 'kpi')?.value;
  if (!kpi) return { tone: 'neutral', text: m.ml_claim_kpi_none };
  const progress = item.facts.find((f) => f.id === 'progress');
  if (!progress) return { tone: 'neutral', text: tx(m.ml_claim_kpi_unread, { kpi }) };
  return progress.tone === 'warning'
    ? { tone: 'warning', text: tx(m.ml_claim_kpi_short, { kpi, range: progress.value }) }
    : { tone: 'success', text: tx(m.ml_claim_kpi_met, { kpi, range: progress.value }) };
}

export interface MetRow extends MetCheck {
  id: 'uat' | 'kpi' | 'council';
  /** A second line under the condition: what this card can and cannot tell. */
  hint?: string;
}

/** The met-when section: its rows, or one line when there are none to list. */
export type MetWhenView =
  | { kind: 'loading' }
  | { kind: 'note'; tone: TriageTone; text: string }
  | { kind: 'rows'; rows: MetRow[] };

export function metWhenView(state: GoalMetWhen | 'failed' | null, item: DecisionItem, m: MonitorCopy, tx: Interpolate): MetWhenView {
  if (state === null) return { kind: 'loading' };
  if (state === 'failed') return { kind: 'note', tone: 'warning', text: m.ml_claim_met_failed };
  if (state.unreadable) return { kind: 'note', tone: 'warning', text: m.ml_claim_met_unreadable };
  const met = state.metWhen;
  if (!met) return { kind: 'note', tone: 'neutral', text: m.ml_claim_met_none };
  const rows: MetRow[] = [];
  if (met.uat !== null) {
    rows.push({
      id: 'uat',
      tone: 'neutral',
      text: met.uat ? tx(m.ml_claim_met_uat, { name: met.uat }) : m.ml_claim_met_uat_unnamed,
      hint: m.ml_claim_met_uat_hint,
    });
  }
  if (met.kpiId !== null) {
    rows.push(met.kpiId === item.payload?.kpiId
      ? { id: 'kpi', ...kpiCheck(item, m, tx) }
      : { id: 'kpi', tone: 'neutral', text: m.ml_claim_met_kpi_other, hint: m.ml_claim_met_kpi_other_hint });
  }
  if (met.council !== null) {
    rows.push({
      id: 'council',
      tone: 'neutral',
      text: met.council === 'full' ? m.ml_claim_met_council_full : m.ml_claim_met_council_lite,
      hint: m.ml_claim_met_council_hint,
    });
  }
  return { kind: 'rows', rows };
}

/** Acts on decided items: envelope changes and reverts are not what is audited. */
export function auditable(acts: readonly CharterAct[]): CharterAct[] {
  return acts.filter((a) => a.itemKind !== 'mandate' && a.itemKind !== 'act.revert');
}

/** FNV-1a: a stable, well-spread rank per (seed, act). */
function rank(seed: string, id: string): number {
  let h = 0x811c9dc5;
  const s = `${id}|${seed}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export const AUDIT_SAMPLE = 3;

/** Up to `n` auditable acts, in a random order fixed by `seed`. */
export function sampleActs(acts: readonly CharterAct[], seed: string, n = AUDIT_SAMPLE): CharterAct[] {
  return auditable(acts)
    .map((a) => ({ a, r: rank(seed, a.id) }))
    .sort((x, y) => x.r - y.r)
    .slice(0, n)
    .map((x) => x.a);
}
