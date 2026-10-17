// Small formatters the panels share. Numbers render in the active language; metric names come from the lens
// manifest's own field label (data), never from a key of ours.
import type { BpText } from '../controller/useBlueprintText';
import type { Plan } from '../model/plan';
import type { WorkItem } from '../model/work';

/** "Wing · Room", or the name once when the wing and the room share it ("Scheduling & classes" twice reads as a stutter). */
export const placeLine = (wing: string, room: string): string => (wing === room ? wing : wing + ' · ' + room);

/** A feature kind in words: a known kind has a key; an unknown one is spaced and lower-cased, never raw caps. */
const KIND_KEY = { user_flow: 'kind_user_flow', capability: 'kind_capability' } as const satisfies Record<string, keyof BpText>;
export function kindWord(B: BpText, kind: string): string {
  const k = KIND_KEY[kind as keyof typeof KIND_KEY];
  return k ? B[k] : kind.replace(/[_-]+/g, ' ').trim().toLowerCase();
}

export const fmtNum = (language: string, v: number): string =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(v);

/**
 * A unit as data wrote it, made singular for exactly one: "1 states" reads "1 state". Units come from the lens
 * manifest and the store in English, so no locale's plural rules reach them; only a plain lowercase word of four
 * letters or more is touched, which leaves symbols and short units (ms, px, %, /s) as they are.
 */
export function unitFor(unit: string, v: number | undefined): string {
  if (Math.abs(v ?? 0) !== 1 || !/^[a-z]{4,}$/.test(unit)) return unit;
  if (unit.endsWith('ies')) return unit.slice(0, -3) + 'y';
  if (/(ss|ch|sh|x|z)es$/.test(unit)) return unit.slice(0, -2);
  return unit.endsWith('s') && !/(ss|us|is)$/.test(unit) ? unit.slice(0, -1) : unit;
}

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
