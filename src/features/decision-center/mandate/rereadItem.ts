/**
 * rereadItem — a signed mandate whose use asks to be read again, as a Sign
 * card (mandate-lanes WP6).
 *
 * `decision_lanes_snapshot` puts `mandate-reread:<charterId>` in Sign when the
 * backend's re-read law fires (`MandateSummary.reread`); this is the item that
 * id joins to. The card is titled with the reason, in words built from the
 * law's code and figures (the backend sends no prose). Its yes is Keep as
 * signed (`mandate_keep`), or Sign the change once the envelope was edited;
 * it has no drop. React-free.
 */
import type { MandateReread } from '@/lib/bindings/MandateReread';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { scopeLabel } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/mandateCopy';

import type { Interpolate, MonitorCopy } from '../deck/deckMeta';
import type { DecisionItem } from '../model/decisionModel';

/** A re-read sits just above a fresh draft: the mandate is already deciding. */
const REREAD_WEIGHT = 56;

export const REREAD_PREFIX = 'mandate-reread:';

export function rereadItemId(charterId: string): string {
  return REREAD_PREFIX + charterId;
}

/** `widen:idea.accept`, `narrow:merge`: the suggestion as a flat payload string. */
export function suggestToken(r: MandateReread): string | undefined {
  if (!r.suggest) return undefined;
  return `${r.suggest.action}:${r.suggest.scope ?? 'merge'}`;
}

export function rereadTitle(r: MandateReread, project: string, m: MonitorCopy, tx: Interpolate): string {
  switch (r.code) {
    // The cap code fires only on a known spend share; an unknown one says so, never 0%.
    case 'cap': return tx(m.ml_reread_title_cap, { project, pct: r.spendPct === null ? m.ml_unknown : r.spendPct });
    case 'asks': return tx(m.ml_reread_title_asks, { project, asks: r.asks, acts: r.acts });
    case 'merges': return tx(m.ml_reread_title_merges, { project, count: r.mergesSinceRead });
    case 'dominant': return tx(m.ml_reread_title_dominant, {
      project,
      scope: r.leadScope ? scopeLabel(m, r.leadScope) : m.ml_unknown,
      count: r.leadAbsorbs,
      asks: r.asks,
    });
  }
}

export function rereadWhy(r: MandateReread, m: MonitorCopy): string {
  switch (r.code) {
    case 'cap': return m.ml_reread_why_cap;
    case 'asks': return m.ml_reread_why_asks;
    case 'merges': return m.ml_reread_why_merges;
    case 'dominant': return m.ml_reread_why_dominant;
  }
}

/** The suggestion in words, or null when the law has none. */
export function rereadSuggestion(r: MandateReread, m: MonitorCopy, tx: Interpolate): string | null {
  const s = r.suggest;
  if (!s) return null;
  if (s.scope === null) return m.ml_reread_suggest_merge;
  const scope = scopeLabel(m, s.scope);
  return s.action === 'widen'
    ? tx(m.ml_reread_suggest_widen, { scope, count: r.leadAbsorbs })
    : tx(m.ml_reread_suggest_narrow, { scope });
}

export function rereadToDecision(s: MandateSummary, r: MandateReread, m: MonitorCopy, tx: Interpolate, skip: string): DecisionItem {
  const steward = s.stewardName ?? m.ml_steward_unknown;
  const project = s.projectName ?? m.ml_project_unknown;
  const facts: DecisionItem['facts'] = [
    { id: 'asks', label: m.ml_reread_fact_asks, value: String(r.asks) },
    { id: 'acts', label: m.ml_reread_fact_acts, value: String(r.acts) },
  ];
  if (r.keptAtActs !== null) facts.push({ id: 'kept', label: m.ml_reread_fact_kept, value: tx(m.ml_reread_kept_at, { count: r.keptAtActs }) });
  return {
    id: rereadItemId(s.charterId),
    sourceId: s.charterId,
    kind: 'mandate',
    title: rereadTitle(r, project, m, tx),
    body: rereadWhy(r, m),
    tags: [],
    facts,
    source: { label: steward, sublabel: project },
    createdAt: s.updatedAt,
    weight: REREAD_WEIGHT,
    branches: [],
    reasonPrompts: [],
    // `reject` names the card's OTHER verb in the head's outcome pair: there
    // is no drop, the alternative to keeping is signing an edited envelope.
    verdictLabels: { accept: m.ml_reread_keep, reject: m.ml_reread_sign_change, skip },
    payload: {
      charterId: s.charterId,
      projectId: s.projectId,
      stewardPersonaId: s.stewardPersonaId,
      reread: r.code,
      suggest: suggestToken(r),
      cost: tx(m.ml_reread_cost, { asks: r.asks, acts: r.acts }),
    },
  };
}
