// channelBubbleModel — which channel arrivals become a speech bubble on a
// persona tile, decided without React so the rules are testable.
//
// TWO SOURCES, and the second one is deliberate.
//
// SOURCE 1 - AMBIENT. The shared channel cache the rail's Messages tab already
// subscribes to (`useMergedChannels`), so lighting a tile costs no IPC the
// board was not already paying. The diff discipline is the one
// `LiveChannelOverlay`'s hidden sink proved: remember every id seen, absorb
// the first populated run as history, and only treat an id as NEW when the
// ledger is established or the row is stamped within a short grace of mount
// (a message that landed while the chunk was loading still deserves to pop).
//
// SOURCE 2 - ASKED. A quick-chat reply, which NO team reader can ever see.
// `post_persona_channel_message` stores the exchange in `team_channel_messages`
// under the sentinel `team_id = 'persona:<id>'`, and every team-scoped reader
// filters on real team ids, so a sentinel row is invisible to all of them BY
// CONSTRUCTION (`db/src/repos/resources/team_channel.rs:457-465` states it in
// those terms). The persona conversation surface reads those rows through its
// own `list_persona_channel` lane instead. So a reply the operator asked for
// would never reach the board through source 1 no matter how long it waited -
// the second source is the only honest way to close the round trip, and it is
// confined to HERE: no team-scoped reader is loosened, and the crossing costs
// no new poll and no new listener (an ask takes a refcounted
// `subscribePersonaChannel`, which the existing channel service already drives
// off the PERSONA_CHANNEL_MESSAGE push).
//
// Unchanged in both sources: steps, events, memories, the operator's own
// directives, Athena and the director are still not tile chatter.
//
// ONE BUBBLE PER PERSONA. A node is 172×48; two overlapping bubbles are an
// unreadable one. When a persona posts twice inside the bubble's life the
// newer text replaces the older and the timer restarts, while the unseen
// counter keeps counting every message — the bubble is a glance, the counter
// is the ledger.

import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { TaggedItem } from '../channels/types';

/** How long an AMBIENT bubble stays before it fades on its own. */
export const BUBBLE_TTL_MS = 10_000;
/**
 * How long an ASKED bubble stays. Nine times the ambient life, because the two
 * are not the same event: ambient chatter is a glance the operator never
 * requested and fifty lines of it must not pile up, while a quick-chat reply
 * answers a question the operator typed and can land up to REPLY_DEADLINE_SECS
 * (30 minutes) later - long after their eyes left that bay. Ten seconds is a
 * blink you miss; ninety is enough to look back, find the line and read 160
 * characters. It stays FINITE because the board's resting state is calm, and
 * opening the persona (`acknowledge`) remains the deliberate clear.
 */
export const ASKED_BUBBLE_TTL_MS = 90_000;
/**
 * A pending ask carries NO fade at all - it is an outstanding request, not an
 * arrival, and it has to survive the whole 30-minute reply deadline.
 */
export const PENDING_BUBBLE_TTL_MS = null;
/** Channel `at` is second-resolution server UTC while an ask is stamped from
 *  the local clock, so a true reply can read a shade older than its ask. */
const REPLY_CLOCK_SLACK_MS = 2_000;
/** Rows stamped this close to mount still pop on the first populated run. */
export const BUBBLE_NEW_GRACE_MS = 15_000;
/** Bound on the seen-id set; the merged window is itself bounded at 600. */
const SEEN_CAP = 800;
/** Longest text a bubble carries — the tile truncates visually anyway, and
 *  the full body is one click away in the drawer. */
const TEXT_CAP = 160;

export type BubbleSource = 'team' | 'persona';

export interface ChatBubble {
  /** The channel item id — what the fade timer checks before removing. */
  id: string;
  personaId: string;
  text: string;
  /** Epoch ms the row was stamped. */
  at: number;
  /** Which of the two sources put it there. Decides the TTL. */
  source: BubbleSource;
  /** An ask whose reply has not landed yet: a quiet mark, never a spinner. */
  pending?: boolean;
}

/** The outstanding question the operator typed at one persona. */
export interface QuickChatAsk {
  personaId: string;
  /** What the operator asked — the pending bubble prints it back. */
  text: string;
  /** Epoch ms the send settled. A reply is a persona row stamped after it. */
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

/** The line the bubble prints: the body, whitespace-collapsed and capped.
 *  Shape-typed, not item-typed — both channels carry a nullable `body`. */
export function bubbleText(item: { body: string | null }): string {
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
    fresh.push({ id: item.id, personaId: item.personaId!, text: bubbleText(item), at: stamped, source: 'team' });
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

/** How long THIS bubble lives; `null` means it never fades on its own. */
export function bubbleTtlMs(b: ChatBubble): number | null {
  if (b.pending) return PENDING_BUBBLE_TTL_MS;
  return b.source === 'persona' ? ASKED_BUBBLE_TTL_MS : BUBBLE_TTL_MS;
}

/** The quiet mark a persona wears from send until its reply lands. */
export function pendingBubble(ask: QuickChatAsk): ChatBubble {
  return {
    id: `ask:${ask.personaId}:${ask.at}`,
    personaId: ask.personaId,
    text: ask.text,
    at: ask.at,
    source: 'persona',
    pending: true,
  };
}

/** The shape `pickPersonaReply` needs out of a `PersonaChannelItem`. */
export interface PersonaChannelRow {
  id: string;
  kind: string;
  at: string;
  authorKind: string;
  body: string | null;
}

/**
 * The persona's answer to one ask, out of a newest-first persona channel: the
 * newest CHAT row the PERSONA wrote at or after the ask. The operator's own
 * row is `authorKind: 'user'`, and so is the optimistic echo, so neither can
 * be mistaken for the reply.
 */
export function pickPersonaReply(
  items: readonly PersonaChannelRow[],
  ask: QuickChatAsk,
): ChatBubble | null {
  for (const i of items) {
    if (i.kind !== 'chat' || i.authorKind !== 'persona') continue;
    const at = Date.parse(i.at);
    if (!Number.isFinite(at) || at < ask.at - REPLY_CLOCK_SLACK_MS) continue;
    const text = bubbleText(i);
    if (!text) continue;
    return { id: i.id, personaId: ask.personaId, text, at, source: 'persona' };
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * THE ASK LEDGER — module state, on purpose.
 *
 * The composer and the bubble hook are siblings with no common React owner:
 * the hook runs inside `useActivitySurface`, the composer mounts beside the
 * board, and the only node above both is the surface hook every other package
 * is also editing. A module singleton keeps the crossing inside this file and
 * keeps the rules testable without React. It is a plain module const, not a
 * `globalThis` key — nothing here is worth surviving a reload.
 * ------------------------------------------------------------------------- */

let asks: ReadonlyMap<string, QuickChatAsk> = new Map();
const askListeners = new Set<() => void>();

/** Stable snapshot for `useSyncExternalStore` — the identity changes only on a
 *  real write, so a subscriber never re-renders for nothing. */
export function getQuickChatAsks(): ReadonlyMap<string, QuickChatAsk> {
  return asks;
}

export function subscribeQuickChatAsks(onChange: () => void): () => void {
  askListeners.add(onChange);
  return () => { askListeners.delete(onChange); };
}

function emitAsks(next: ReadonlyMap<string, QuickChatAsk>): void {
  asks = next;
  for (const fn of askListeners) fn();
}

/** The operator just sent a quick instruction: mark the persona pending. */
export function recordQuickChatAsk(personaId: string, text: string, at: number): void {
  const next = new Map(asks);
  next.set(personaId, { personaId, text: bubbleText({ body: text }), at });
  emitAsks(next);
}

/** The reply landed, or the operator opened the persona and read it there. */
export function clearQuickChatAsk(personaId: string): void {
  if (!asks.has(personaId)) return;
  const next = new Map(asks);
  next.delete(personaId);
  emitAsks(next);
}

/** Test seam only — the ledger outlives a `renderHook`. */
export function resetQuickChatAsks(): void {
  emitAsks(new Map());
}
