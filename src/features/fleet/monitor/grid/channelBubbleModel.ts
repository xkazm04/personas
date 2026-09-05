// channelBubbleModel — which channel arrivals become a speech bubble on a
// persona tile, decided without React so the rules are testable.
//
// THE SOURCE is the shared channel cache the rail's Messages tab already
// subscribes to (`useMergedChannels`), so lighting a tile costs no IPC the
// board was not already paying. The diff discipline is the one
// `LiveChannelOverlay`'s hidden sink proved: remember every id seen, absorb
// the first populated run as history, and only treat an id as NEW when the
// ledger is established or the row is stamped within a short grace of mount
// (a message that landed while the chunk was loading still deserves to pop).
//
// ONE BUBBLE PER PERSONA. A tile is 152×38; two overlapping bubbles are an
// unreadable one. When a persona posts twice inside the bubble's life the
// newer text replaces the older and the timer restarts, while the unseen
// counter keeps counting every message — the bubble is a glance, the counter
// is the ledger.

import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { TaggedItem } from '../channels/types';

/** How long a bubble stays before it fades on its own. */
export const BUBBLE_TTL_MS = 10_000;
/** Rows stamped this close to mount still pop on the first populated run. */
export const BUBBLE_NEW_GRACE_MS = 15_000;
/** Bound on the seen-id set; the merged window is itself bounded at 600. */
const SEEN_CAP = 800;
/** Longest text a bubble carries — the tile truncates visually anyway, and
 *  the full body is one click away in the drawer. */
const TEXT_CAP = 160;

export interface ChatBubble {
  /** The channel item id — what the fade timer checks before removing. */
  id: string;
  personaId: string;
  text: string;
  /** Epoch ms the row was stamped. */
  at: number;
}

export interface BubbleLedger {
  seen: Set<string>;
  established: boolean;
  mountAt: number;
}

export function createBubbleLedger(now: number): BubbleLedger {
  return { seen: new Set(), established: false, mountAt: now };
}

/**
 * A persona speaking in its team channel. Steps, events, memories, the
 * operator's own directives, Athena and the director are not tile chatter:
 * a bubble says "this member just said something", and only a persona row
 * carries both a persona and a sentence.
 */
export function isPersonaChat(item: TeamChannelItem): boolean {
  return item.kind === 'persona' && !!item.personaId && !!bubbleText(item);
}

/** The line the bubble prints: the body, whitespace-collapsed and capped. */
export function bubbleText(item: TeamChannelItem): string {
  const raw = (item.body ?? '').replace(/\s+/g, ' ').trim();
  return raw.length > TEXT_CAP ? `${raw.slice(0, TEXT_CAP - 1)}…` : raw;
}

/**
 * Walk the merged feed, mark every id seen, and return the NEW persona rows
 * for personas on the board — every one of them, newest first, so the caller
 * can count them and pick the latest per persona. Mutates the ledger.
 */
export function diffChatArrivals(
  ledger: BubbleLedger,
  merged: readonly TaggedItem[],
  personaIds: ReadonlySet<string>,
  now: number,
): ChatBubble[] {
  const fresh: ChatBubble[] = [];
  for (const tg of merged) {
    const { item } = tg;
    if (ledger.seen.has(item.id)) continue;
    ledger.seen.add(item.id);
    if (!isPersonaChat(item) || !personaIds.has(item.personaId!)) continue;
    const atMs = Date.parse(item.at);
    const stamped = Number.isFinite(atMs) ? atMs : now;
    const isLive = ledger.established || stamped >= ledger.mountAt - BUBBLE_NEW_GRACE_MS;
    if (!isLive) continue;
    fresh.push({ id: item.id, personaId: item.personaId!, text: bubbleText(item), at: stamped });
  }
  if (merged.length > 0) ledger.established = true;
  if (ledger.seen.size > SEEN_CAP) ledger.seen = new Set(merged.map((m) => m.item.id));
  fresh.sort((a, b) => b.at - a.at);
  return fresh;
}

/** The newest bubble per persona out of a newest-first list. */
export function latestPerPersona(fresh: readonly ChatBubble[]): Map<string, ChatBubble> {
  const out = new Map<string, ChatBubble>();
  for (const b of fresh) if (!out.has(b.personaId)) out.set(b.personaId, b);
  return out;
}
