import { eventFamily, type EventFamily } from '@/lib/channel/eventModel';
import type { ChannelKind } from '@/api/pipeline/teamChannel';
import type { TaggedItem } from './types';

/* ----------------------------------------------------------------------------
 * LENS MODEL — the Stream's filter vocabulary, shared by every variant.
 *
 * The Stream replaces two filter systems that described the same feed in
 * different words: `feedFilter.ts` (all/signal/alerts + you/athena) and Collab's
 * inline talk/activity. Both are subsumed here.
 *
 * Five composable dimensions, ANDed:
 *   kind      — which SOURCE (step/event/memory/message/deliberation). Pushed
 *               down into SQL (P1), so selecting one spends the whole page
 *               budget on it and it cannot be starved by a chatty neighbour.
 *   family    — the Red Room's 8 event families, derived from the raw
 *               `event_type` (which the read-model returns as an event's label).
 *   callsign  — who spoke. Personas ranked by traffic volume.
 *   team      — which channels feed the stream.
 *   search    — free text over body + label + callsign.
 *
 * Pure: no React, no store, no IPC.
 * -------------------------------------------------------------------------- */

export const ALL_KINDS: ChannelKind[] = ['step', 'event', 'memory', 'message', 'deliberation'];

export const ALL_FAMILIES: EventFamily[] = [
  'handoff', 'pr', 'qa', 'release', 'failure', 'build', 'note', 'other',
];

/** Memory's analytical presentations (D2). Gated: only when memory is the sole
 *  kind AND a single team is scoped (D8 — a run-diff compares runs of ONE team). */
export type MemoryMode = 'list' | 'timeline' | 'diff';

export interface LensState {
  /** Empty = all kinds (the blended conversation). */
  kinds: Set<ChannelKind>;
  /** Empty = all families. Only narrows `event` rows. */
  families: Set<EventFamily>;
  /** Empty = all speakers. */
  callsigns: Set<string>;
  search: string;
  memoryMode: MemoryMode;
}

export const EMPTY_LENS: LensState = {
  kinds: new Set(),
  families: new Set(),
  callsigns: new Set(),
  search: '',
  memoryMode: 'list',
};

/** How many lens dimensions are actually narrowing the feed. Drives the
 *  "N active" affordance and the clear-all button. */
export function activeLensCount(l: LensState): number {
  return (
    (l.kinds.size > 0 ? 1 : 0) +
    (l.families.size > 0 ? 1 : 0) +
    (l.callsigns.size > 0 ? 1 : 0) +
    (l.search.trim() ? 1 : 0)
  );
}

/** The family of a row. Memory rows are the 'note' pseudo-family (they have no
 *  event_type); everything non-event has none. */
export function rowFamily(item: TaggedItem['item']): EventFamily | null {
  if (item.kind === 'memory') return 'note';
  if (item.kind !== 'event') return null;
  return eventFamily(item.label);
}

/** Uppercase air-traffic callsign ("T: QA Guardian" → "QA-GUARDIAN"). */
export function callsign(name: string | undefined): string {
  if (!name) return 'SYSTEM';
  return name
    .replace(/^T:\s*/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 14);
}

/**
 * The kind lens is enforced SERVER-side (it decides which source queries run).
 * Family / callsign / search narrow within whatever came back, so they apply
 * here. Keeping the kind check too makes this a total predicate — safe to run
 * over a cache that was fetched blended.
 */
export function matchesLens(
  row: TaggedItem,
  lens: LensState,
  nameOf: (personaId: string | null) => string | undefined,
): boolean {
  const { item } = row;

  if (lens.kinds.size > 0 && !lens.kinds.has(itemKind(item))) return false;

  if (lens.families.size > 0) {
    const fam = rowFamily(item);
    if (!fam || !lens.families.has(fam)) return false;
  }

  if (lens.callsigns.size > 0) {
    if (!item.personaId || !lens.callsigns.has(item.personaId)) return false;
  }

  const q = lens.search.trim().toLowerCase();
  if (q) {
    const hay = `${item.body ?? ''} ${item.label} ${callsign(nameOf(item.personaId))}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  return true;
}

/** Map a read-model row's `kind` onto the lens vocabulary. The backend returns
 *  author kinds (directive/persona/athena/director) for channel messages; the
 *  lens collapses them all to `message`. */
export function itemKind(item: TaggedItem['item']): ChannelKind {
  switch (item.kind) {
    case 'step':
      return 'step';
    case 'event':
      return 'event';
    case 'memory':
      return 'memory';
    default:
      return item.deliberationId ? 'deliberation' : 'message';
  }
}

export interface Facet<T> {
  key: T;
  count: number;
}

/**
 * Facet counts for the rail. Each dimension is counted against the rows that
 * survive the OTHER dimensions — so a count tells you "selecting this adds N
 * rows to what you're already looking at", not a misleading global total.
 */
export function facetCounts(
  rows: TaggedItem[],
  lens: LensState,
  nameOf: (personaId: string | null) => string | undefined,
) {
  const without = (patch: Partial<LensState>) => {
    const l = { ...lens, ...patch };
    return rows.filter((r) => matchesLens(r, l, nameOf));
  };

  const kindRows = without({ kinds: new Set() });
  const kinds: Facet<ChannelKind>[] = ALL_KINDS.map((k) => ({
    key: k,
    count: kindRows.filter((r) => itemKind(r.item) === k).length,
  }));

  const famRows = without({ families: new Set() });
  const families: Facet<EventFamily>[] = ALL_FAMILIES.map((f) => ({
    key: f,
    count: famRows.filter((r) => rowFamily(r.item) === f).length,
  }));

  const signRows = without({ callsigns: new Set() });
  const counts = new Map<string, number>();
  for (const r of signRows) {
    if (r.item.personaId) counts.set(r.item.personaId, (counts.get(r.item.personaId) ?? 0) + 1);
  }
  const callsigns: Facet<string>[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1]) // ranked by traffic volume (the Red Room's rule)
    .map(([key, count]) => ({ key, count }));

  return { kinds, families, callsigns };
}

/** Memory's analytical modes are only coherent for one team's memories (D2/D8). */
export function memoryModesAvailable(lens: LensState, selectedTeamCount: number): boolean {
  return lens.kinds.size === 1 && lens.kinds.has('memory') && selectedTeamCount === 1;
}

/** The kinds to ASK THE SERVER for. Empty lens = the blended conversation
 *  (deliberation turns stay opt-in, so they're excluded unless asked for). */
export function fetchKinds(lens: LensState): ChannelKind[] | undefined {
  return lens.kinds.size > 0 ? [...lens.kinds] : undefined;
}
