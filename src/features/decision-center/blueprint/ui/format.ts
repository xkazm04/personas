// Small formatters the panels share. Numbers render in the active language; metric names come from the lens
// manifest's own field label (data), never from a key of ours.
import type { Plan } from '../model/plan';
import type { WorkItem } from '../model/work';

export const fmtNum = (language: string, v: number): string =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(v);

export const signed = (language: string, v: number): string =>
  (v > 0 ? '+' : '') + fmtNum(language, v);

/** The name of the metric an item moves: the lens field's label, else the store's key. */
export function metricLabel(plan: Plan, p: WorkItem): string {
  const f = p.metric ? plan.LENS[p.lens]?.F[p.metric] : undefined;
  return f ? f.label : p.metric ?? '';
}

/** "Accessibility: 3 → 2 (-1)": what the item is expected to do to its metric. */
export function deltaText(plan: Plan, p: WorkItem, language: string): string {
  const name = metricLabel(plan, p);
  if (p.delta == null) return name;
  if (p.before == null) return `${name} ${signed(language, p.delta)}`;
  return `${name}: ${fmtNum(language, p.before)} → ${fmtNum(language, p.before + p.delta)} (${signed(language, p.delta)})`;
}
