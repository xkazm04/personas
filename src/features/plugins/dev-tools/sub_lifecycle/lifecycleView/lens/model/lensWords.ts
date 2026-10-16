/**
 * The sentences the Lens says, counted from the portfolio. One door for every
 * verdict and outcome word (the existing `lc1_health_*`, `lc2_health_phrase_*`
 * and `lc_outcome_*` keys), so the status vocabulary is typed once.
 */
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { useTranslation } from '@/i18n/useTranslation';

import { bindingKindLabel, outcomeLabel, stepLabel } from '../../../journey/journeyLabels';
import type { HealthStep } from '../../layer1/healthModel';
import { worstHealth, type LensColumn, type LensProject, type Portfolio } from './portfolioModel';

type T = ReturnType<typeof useTranslation>;
export type Dl = T['t']['plugins']['dev_lifecycle'];
export type Tx = T['tx'];

export function healthLabel(dl: Dl, h: LifecycleHealth): string {
  return dl[`lc1_health_${h}`];
}

export function healthPhrase(dl: Dl, h: LifecycleHealth): string {
  return dl[`lc2_health_phrase_${h}`];
}

export function outcomeWord(dl: Dl, o: LifecycleOutcome): string {
  return outcomeLabel(dl, o);
}

export function columnName(dl: Dl, c: Pick<LensColumn, 'id' | 'label'>): string {
  return stepLabel(dl, c.id, c.label);
}

export function laneName(dl: Dl, phase: LensColumn['phase']): string {
  return phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after;
}

export function projectLabel(p: Pick<LensProject, 'name' | 'qualifier'>): string {
  return p.qualifier ? `${p.name} (${p.qualifier})` : p.name;
}

/** The phrase under a portfolio column: its worst verdict, counted. */
export function columnFoot(dl: Dl, tx: Tx, c: LensColumn): { text: string; health: LifecycleHealth } {
  const n = c.counts;
  if (n.red) return { text: tx(dl.lens_foot_failing, { count: n.red }), health: 'red' };
  if (n.amber) return { text: tx(dl.lens_foot_at_risk, { count: n.amber }), health: 'amber' };
  if (n.stale) return { text: tx(dl.lens_foot_stale, { count: n.stale }), health: 'stale' };
  if (c.missing) return { text: tx(dl.lens_foot_missing, { count: c.missing }), health: 'unmeasured' };
  if (n.green) return { text: tx(dl.lens_foot_healthy, { count: n.green }), health: 'green' };
  const h = worstHealth(n);
  return { text: healthLabel(dl, h), health: h };
}

/** The display line for a step at portfolio scale; `{step}` is a slot the header inks. */
export function columnTitle(dl: Dl, c: LensColumn): { template: string; count: number; health: LifecycleHealth } {
  const n = c.counts;
  const pick = (h: 'red' | 'amber' | 'stale' | 'green') => {
    const one = n[h] === 1;
    const key = ({ red: one ? 'lens_title_red_one' : 'lens_title_red', amber: one ? 'lens_title_amber_one' : 'lens_title_amber',
      stale: one ? 'lens_title_stale_one' : 'lens_title_stale', green: one ? 'lens_title_green_one' : 'lens_title_green' } as const)[h];
    return { template: dl[key], count: n[h], health: h };
  };
  if (n.red) return pick('red');
  if (n.amber) return pick('amber');
  if (n.stale) return pick('stale');
  if (n.green) return pick('green');
  if (n.instructed === c.rows.length) return { template: dl.lens_title_instructed, count: 0, health: 'instructed' };
  return { template: dl.lens_title_unmeasured, count: 0, health: 'unmeasured' };
}

/** The verdict mix at a step, worst first: "8 failing, 17 not measured". */
export function countsSentence(dl: Dl, tx: Tx, c: LensColumn): string {
  const order: LifecycleHealth[] = ['red', 'amber', 'stale', 'green', 'unmeasured', 'instructed'];
  const parts = order.filter((h) => c.counts[h]).map((h) => tx(dl.lens_count_phrase, { count: c.counts[h], phrase: healthPhrase(dl, h) }));
  return tx(dl.lens_lede_counts, { parts: parts.join(', ') });
}

/** The lede under a step at portfolio scale: who to start with, then the mix. */
export function columnLede(dl: Dl, tx: Tx, c: LensColumn): string {
  const out: string[] = [];
  const first = c.rows[0];
  if (first && first.step.health === 'red') {
    const reason = first.step.reason?.replace(/\.\s*$/, '');
    out.push(reason
      ? tx(dl.lens_lede_start, { name: projectLabel(first.project), reason })
      : tx(dl.lens_lede_start_plain, { name: projectLabel(first.project) }));
  }
  out.push(countsSentence(dl, tx, c));
  if (c.missing) {
    const kind = c.rows[0]?.step.node.bindingKinds[0];
    const binding = kind ? bindingKindLabel(dl, kind) : '';
    out.push(c.missing === 1 ? tx(dl.lens_lede_missing_one, { binding }) : tx(dl.lens_lede_missing, { count: c.missing, binding }));
  }
  if (c.counts.unmeasured && !c.counts.red) out.push(dl.lens_lede_not_low);
  return out.join(' ');
}

/** The one sentence a step says at project scale: its reason, else its verdict. */
export function stepSentence(dl: Dl, s: HealthStep): string {
  return s.reason ? s.reason.replace(/\.?\s*$/, '.') : `${healthLabel(dl, s.health)}.`;
}

/** The eyebrow of the portfolio plane. */
export function portfolioEyebrow(dl: Dl, tx: Tx, p: Portfolio, total: number): string {
  const parts = [tx(dl.lens_eyebrow_portfolio, { count: total })];
  if (p.projects.length < total) parts.push(tx(dl.lens_eyebrow_reading, { read: p.projects.length, total }));
  parts.push(p.measured ? tx(dl.lens_eyebrow_measured, { count: p.measured, total: p.projects.length }) : dl.lens_eyebrow_never_measured);
  return parts.join(' · ');
}
