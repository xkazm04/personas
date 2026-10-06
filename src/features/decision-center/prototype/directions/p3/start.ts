/**
 * Where the P3 hub opens. The Lab's `initial` covers strip / peek / modal; P3
 * adds four dev-only kits it reads itself (the Lab falls back to `strip` for
 * an entry it does not know, so these never reach another direction):
 *   ?kit=p3:report-html   the reading room on the HTML report (report:rep2)
 *   ?kit=p3:council       the reading room on the council report (Approve / Send back)
 *   ?kit=p3:triage-all    the desk walking the whole roster
 *   ?kit=p3:strip-states  the strip with a FAILED chip (council) and a ZERO chip (chat)
 */
import {
  chipOf, modalTypeOf,
  type ChipCount, type DecisionChip, type DecisionItem, type HubChip,
} from '../../../model/decisionModel';
import type { HubInitial } from '../../directionContract';
import { queueFor } from './model';

export interface Start {
  peek: HubChip | null;
  desk: { scope: DecisionChip | 'all'; index: number; origin: 'peek' | 'strip' } | null;
  demoStates: boolean;
}

function readP3Kit(): string | null {
  if (typeof window === 'undefined') return null;
  const kit = new URLSearchParams(window.location.search).get('kit');
  return kit?.startsWith('p3:') ? kit.slice(3) : null;
}

function deskAt(items: DecisionItem[], id: string | undefined): Start['desk'] {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const chip = chipOf(item.kind);
  return { scope: chip, index: queueFor(items, chip).indexOf(item), origin: 'peek' };
}

export function resolveStart(items: DecisionItem[], initial: HubInitial): Start {
  const none: Start = { peek: null, desk: null, demoStates: false };
  const kit = readP3Kit();
  if (initial.level === 'strip') {
    if (kit === 'report-html') return { ...none, desk: deskAt(items, items.find((i) => i.document?.format === 'html')?.id) };
    if (kit === 'council') return { ...none, desk: deskAt(items, items.find((i) => i.kind === 'council')?.id) };
    if (kit === 'triage-all') return { ...none, desk: { scope: 'all', index: 0, origin: 'strip' } };
    if (kit === 'strip-states') return { ...none, demoStates: true };
    return none;
  }
  if (initial.level === 'peek') return { ...none, peek: initial.chip };
  // modal:report opens the markdown REPORT (not the council) so → walks on to the HTML one.
  const pick = initial.type === 'report'
    ? items.find((i) => i.kind === 'report') ?? items.find((i) => modalTypeOf(i.kind) === 'report')
    : items.find((i) => modalTypeOf(i.kind) === initial.type);
  return { ...none, desk: deskAt(items, pick?.id) };
}

/** Demo the two honest non-states: council's source failed, chat has nothing. */
export function withDemoStates(items: DecisionItem[], counts: Record<HubChip, ChipCount>) {
  return {
    items: items.filter((i) => chipOf(i.kind) !== 'chat'),
    counts: {
      ...counts,
      council: { n: 0, lamp: 'danger' as const, failed: true },
      chat: { n: 0, lamp: 'neutral' as const, failed: false },
    },
  };
}
