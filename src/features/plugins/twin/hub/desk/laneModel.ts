/**
 * What each Hub lane is, derived from the ONE feed the desk already loaded.
 *
 * The desk has four lanes over `HubFeedApi` and no lane issues a query of its
 * own: Queue is the reviewable backlog, History is everything that already
 * carries a verdict plus the message log, Knowledge is what the brain produced
 * (facts and reflections), and Replies is the outbound loop, which owns its own
 * fetch because its rows are not feed entries at all.
 *
 * The partition is deliberate and total for the feed's five kinds: a `memory`
 * or `audit` row sits in Queue while it is pending and in History once it is
 * not, a `message` is always History, and `fact` / `reflection` are always
 * Knowledge. Nothing is in two lanes and nothing is in none.
 */

import { isReviewable, type HubCounts, type HubEntry } from '../hubContract';

export type HubLaneId = 'queue' | 'history' | 'knowledge' | 'replies';

/** Lane order in the control. Queue is the default because it is the work. */
export const HUB_LANES: readonly HubLaneId[] = ['queue', 'history', 'knowledge', 'replies'];

export type HubHistoryFilter = 'all' | 'approved' | 'rejected';

export const HUB_HISTORY_FILTERS: readonly HubHistoryFilter[] = ['all', 'approved', 'rejected'];

/**
 * Rows History renders before it caps and says so in one line — the count the
 * River carried, for the same reason: variable-height prose rows at the
 * few-hundred-row scale the wire itself is limited to (`COMMUNICATION_LIMIT`)
 * buy jitter from a virtualizer, not speed.
 */
export const HISTORY_RENDER_CAP = 300;

/** The pending backlog, newest first (the feed's own order). */
export function queueEntries(entries: HubEntry[]): HubEntry[] {
  return entries.filter(isReviewable);
}

/**
 * Everything already filed, newest first: approved and rejected memories plus
 * the message log. Pending rows are NOT here — they are the Queue's work, and a
 * row in both lanes would let the same entry be reviewed twice.
 *
 * A status filter is a claim about reviewed rows, so a kind that carries no
 * verdict (a message) drops out of `approved` / `rejected` rather than
 * pretending to satisfy it.
 */
export function historyEntries(entries: HubEntry[], filter: HubHistoryFilter): HubEntry[] {
  return entries.filter((e) => {
    if (e.kind === 'fact' || e.kind === 'reflection') return false;
    if (e.status === 'pending') return false;
    if (filter === 'all') return true;
    return e.status === filter;
  });
}

/** What the brain produced rather than received: distilled facts and reflections. */
export function knowledgeEntries(entries: HubEntry[]): HubEntry[] {
  return entries.filter((e) => e.kind === 'fact' || e.kind === 'reflection');
}

/**
 * The lane badge, composed from the counts the shell already reads — each
 * underlying number is read ONCE, in `useHubFeed`, and never recounted here.
 * Replies has no badge: its rows come from the channels slice, so any number
 * this function could invent would be a claim about data it has not seen.
 */
export function laneCount(lane: HubLaneId, counts: HubCounts): number | null {
  switch (lane) {
    case 'queue':
      return counts.pending;
    case 'history':
      return counts.approved + counts.rejected + counts.messages;
    case 'knowledge':
      return counts.facts + counts.reflections;
    case 'replies':
      return null;
  }
}
