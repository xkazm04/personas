// The decision brief of one open card, over what the sheet already holds (bp's apps/web Brief.tsx briefOfDecision, for a
// live product): the store as bp's wire (`data.scan`) and the map. No IPC and no network: bp and Personas meet only in
// the store and the map. The map is read with the ported briefMapOf over the raw document, and its lens names are taken
// from the plan's registry (bp's browser reads them from its loader, which knows the built-in lenses' names; the raw
// map may name a built-in lens by id alone).
import type { BlueprintData } from '../source';
import type { Plan } from './plan';
import type { WorkItem } from './work';
import { briefFor, briefMapOf, repeatNote, subjectOf, type Brief, type BriefMap } from './brief';

/** One map per plan: the plan is rebuilt only when the map or the events change, never for a status flip. */
const MAPS = new WeakMap<Plan, BriefMap>();

export function briefMapOfPlan(structure: unknown, plan: Plan): BriefMap {
  let m = MAPS.get(plan);
  if (!m) {
    const raw = briefMapOf(structure);
    m = { ...raw, lenses: raw.lenses.map((l) => ({ id: l.id, name: plan.LENS[l.id]?.name ?? l.name })) };
    MAPS.set(plan, m);
  }
  return m;
}

/** The brief of a waiting item; null for any other status (a decided item has nothing left to decide). */
export function cardBrief(data: Pick<BlueprintData, 'structure' | 'scan'>, plan: Plan, p: WorkItem): Brief | null {
  if (p.status !== 'proposed') return null;
  return briefFor(subjectOf(p.row), data.scan, briefMapOfPlan(data.structure, plan));
}

/** A repeat of a declined idea (identity, never likeness): the card makes Decline its first answer. */
export const isRepeat = (b: Brief | null): boolean => b?.advice.say === 'withdraw' && b.declines.length > 0;

/** What a Decline on this card starts with: on a repeat, the note naming the decision it repeats; else nothing. */
export function declinePrefill(b: Brief | null): string {
  const d = b?.advice.say === 'withdraw' ? b.declines[0] : undefined;
  return d ? repeatNote(d) : '';
}

/** The card's chip (bp Brief.tsx adviceChip): a repeat; a like idea declined elsewhere; a lens mostly declined; none. */
export type BriefChip = 'repeat' | 'like' | 'mostly';
export const briefChip = (b: Brief): BriefChip | null =>
  b.advice.say === 'withdraw' ? 'repeat' : b.advice.say === 'ask' ? (b.declines.length ? 'like' : 'mostly') : null;
