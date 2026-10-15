/**
 * claimModel — the Accept card for a goal claim (`goal:<id>` awaiting
 * acceptance): its met-when checklist and the audit sample. React-free.
 *
 * Met-when: `dev_goals.met_when` exists (migration e67) but NOTHING reads it
 * yet: no repo function, no command, no binding field. So the checklist shows
 * only what is honestly known, the goal's KPI from the acceptance row the
 * goal card already carries (`kpi` and `progress` facts), and says that the
 * UAT and council checks are not shown. It never invents a tick.
 *
 * Audit sample: a few of the mandate's acts picked at random, so the operator
 * judges the steward's work by spot check rather than by its own summary. The
 * pick is seeded by the card (the same card shows the same sample while it is
 * open, so a key never jumps to another row), and envelope acts are left out:
 * the sample is about decisions taken, not about the envelope itself.
 */
import type { TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import type { CharterAct } from '@/lib/bindings/CharterAct';

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
