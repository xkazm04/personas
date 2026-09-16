// messageThreads — the Messages tab as a messenger thread list.
//
// The tab used to be ONE merged channel feed (up to 600 items) grouped by
// project, badged with the unread MESSAGE count. At fleet scale that is a
// single scroll of hundreds of lines whose badge says "569" and helps nobody
// decide what to open. A messenger answers the same question with threads: one
// row per counterpart, the latest line as a preview, and a badge that counts
// the conversations waiting on you rather than the lines in them.
//
// React-free and store-free, like `railModel`: lookups and watermarks arrive
// as arguments, and names arrive PRE-TRANSLATED.
//
// ## Thread keys — who a message belongs to
//
// Evaluated in this order, first match wins:
//
//   1. A USER DIRECTIVE THAT REPLIES (`kind === 'directive'` with a `replyTo`
//      whose target is in the window) joins the TARGET's thread. Replying from
//      a persona's thread posts a directive with no persona on it; without this
//      rule the reply would vanish from the conversation it was written into
//      and surface in the team thread instead.
//   2. PERSONA — `persona:<personaId>` when `personaId` resolves to a known
//      persona (and the item is not a bridged `slack` row, whose author id is
//      not a persona id). Every kind qualifies, steps and memories included:
//      that is the persona's own activity, and it is who you would reply to.
//      A persona that posts into two teams is still ONE thread.
//   3. SYSTEM — `system` for machine items with no resolvable author:
//      `event`, `step`, `memory`. One thread across every team, because a
//      system has no identity worth splitting by.
//   4. TEAM — `team:<teamId>` for everything else: the user's own directives,
//      `director`, `athena`, bridged `slack` humans, and team posts whose
//      persona no longer resolves. These are voices speaking to the ROOM.
//
// ## Unread
//
// Per item, the channel slice's `countUnread` definition: newer than the
// watermark and not a `directive` (you never have unread mail from yourself).
// The watermark is the LATER of the thread's own watermark (set when the thread
// is opened) and the item's team watermark from the channel slice — so a thread
// with no watermark of its own falls back to the team's, and reading the team
// in Conversations still counts as having read it here. ISO instants from the
// channel are normalized RFC3339 UTC, so string comparison is time order.

import type { Persona } from '@/lib/bindings/Persona';
import type { TaggedItem } from '../../channels/types';

export type ThreadKind = 'persona' | 'team' | 'system';

export interface MessageThread {
  key: string;
  kind: ThreadKind;
  /** Display name, pre-resolved (persona name, team name, or the system label). */
  name: string;
  /** Set on persona threads only. */
  personaId: string | null;
  /** The thread's messages, NEWEST FIRST (the merged feed's own order). */
  items: TaggedItem[];
  /** `items[0]` — the preview, the time, and the team a reply goes to. */
  latest: TaggedItem;
  /** Messages in this thread the user has not seen. */
  unread: number;
}

export interface ThreadLookups {
  personaOf: (id: string) => Persona | undefined;
  /** The thread's own read watermark, or null when it has none. */
  threadSeenOf: (key: string) => string | null;
  /** The channel slice's per-team watermark (`lastSeenAt`). */
  teamSeenOf: (teamId: string) => string | null;
  /** Pre-translated names for the threads that have no persona or team name. */
  systemName: string;
  teamName: (tagged: TaggedItem) => string;
}

export const SYSTEM_THREAD_KEY = 'system';
const MACHINE_KINDS = new Set(['event', 'step', 'memory']);

/** Rules 2-4 of the header. Rule 1 needs the whole window and lives below. */
export function baseThreadKey(tagged: TaggedItem, personaOf: ThreadLookups['personaOf']): string {
  const { item, team } = tagged;
  if (item.kind !== 'slack' && item.personaId && personaOf(item.personaId)) {
    return `persona:${item.personaId}`;
  }
  if (MACHINE_KINDS.has(item.kind)) return SYSTEM_THREAD_KEY;
  return `team:${team.teamId}`;
}

function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/** The unread rule, per item — see the header. */
export function isUnreadIn(tagged: TaggedItem, threadKey: string, lk: ThreadLookups): boolean {
  if (tagged.item.kind === 'directive') return false;
  const seen = laterOf(lk.threadSeenOf(threadKey), lk.teamSeenOf(tagged.team.teamId));
  return seen === null || tagged.item.at > seen;
}

/**
 * Group a merged, newest-first channel window into threads, newest thread
 * first (first appearance in a newest-first list already IS that order).
 */
export function buildMessageThreads(merged: TaggedItem[], lk: ThreadLookups): MessageThread[] {
  const keyOfItem = new Map<string, string>();
  for (const tg of merged) keyOfItem.set(tg.item.id, baseThreadKey(tg, lk.personaOf));

  const byKey = new Map<string, MessageThread>();
  for (const tg of merged) {
    const { item } = tg;
    let key = keyOfItem.get(item.id)!;
    if (item.kind === 'directive' && item.replyTo) {
      key = keyOfItem.get(item.replyTo) ?? key;
    }
    let thread = byKey.get(key);
    if (!thread) {
      // From the KEY, not the item: a reply directive can open a persona's
      // thread (rule 1) and carries no persona id of its own.
      const persona = key.startsWith('persona:') ? lk.personaOf(key.slice('persona:'.length)) : undefined;
      thread = {
        key,
        kind: persona ? 'persona' : key === SYSTEM_THREAD_KEY ? 'system' : 'team',
        name: persona
          ? persona.name.replace(/^T: /, '')
          : key === SYSTEM_THREAD_KEY
            ? lk.systemName
            : lk.teamName(tg),
        personaId: persona ? persona.id : null,
        items: [],
        latest: tg,
        unread: 0,
      };
      byKey.set(key, thread);
    }
    thread.items.push(tg);
    if (isUnreadIn(tg, key, lk)) thread.unread += 1;
  }
  return [...byKey.values()];
}

/** The tab badge: threads with anything unread, not messages. */
export function countUnreadThreads(threads: MessageThread[]): number {
  let n = 0;
  for (const th of threads) if (th.unread > 0) n += 1;
  return n;
}
