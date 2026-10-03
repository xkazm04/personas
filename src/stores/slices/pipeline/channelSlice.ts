import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";

import {
  listTeamChannel,
  postTeamDirective,
  countTeamChannelKinds,
  type ChannelKind,
} from "@/api/pipeline/teamChannel";
import { silentCatch } from "@/lib/silentCatch";
import { createCachedFetch } from "@/lib/async/createCachedFetch";
import type { TeamChannelItem } from "@/lib/bindings/TeamChannelItem";
import type { ChannelKindCounts } from "@/lib/bindings/ChannelKindCounts";

/* ----------------------------------------------------------------------------
 * CHANNEL SLICE — the single owner of team-channel state.
 *
 * Before this slice, three surfaces each mounted their own per-team feed hook,
 * each with its own 15s poll and its own TEAM_ASSIGNMENT_PROGRESS listener — so
 * watching N teams cost 3N of each. Now surfaces `subscribeChannel` (refcounted)
 * and exactly one poll loop + one push listener (`useChannelService`, mounted
 * once in BackgroundServices) refreshes whatever is currently subscribed.
 *
 * The cache is keyed by (team, KINDS), not by team. The Stream's kind lens is
 * pushed down into SQL — asking for `memory` runs only the memory query — so a
 * blended page and a memory-only page are different pages of different queries
 * and cannot share a cache entry. `useTeamChannel` uses the blended key; the
 * Stream uses whatever its lens asks for.
 *
 * See docs/plans/monitor-consolidation.md § Pillar 0 + Pillar 2.
 * -------------------------------------------------------------------------- */

/** Rows fetched per page. */
export const CHANNEL_PAGE = 60;

/** Poll cadence for the sources with no push channel (bus events, memories). */
export const CHANNEL_POLL_MS = 15_000;

const LAST_SEEN_PREFIX = "personas.channel.lastSeen.";

/**
 * SUBSCRIBE-TIME HEAD FETCH — freshness-gated, because a re-subscribe is not
 * news.
 *
 * `subscribeChannel` is refcounted, so only a 0 -> 1 transition fetches. That
 * reads as "fetch once per channel", and it is not: a surface whose WATCHED SET
 * changes membership releases every key and re-takes every key in the same
 * commit (`useTeamChannel.useChannelSubscription` keys its effect on the joined
 * id list, so one added team tears the whole set down and rebuilds it). Every
 * key therefore passes through refcount 0 and back to 1, and every one of them
 * re-issued a full `list_team_channel` for a page it was already holding. The
 * app shell subscribes from `LiveChannelOverlay` (mounted in `App.tsx`), whose
 * watched set is `teams` filtered by which of them has a home persona — two
 * independently-arriving stores, so the set grows in waves on a cold start and
 * each wave re-fetched every channel already loaded.
 *
 * Note the asymmetry this closes: the sibling call two lines below it
 * (`fetchChannelCounts`) was ALREADY guarded by a cache check
 * (`!get().channelCounts[teamId]`), so the counts read never joined the storm.
 * Only the head read was unguarded.
 *
 * `invokeWithTimeout`'s 250ms auto-dedup never collapsed this: the waves are
 * driven by separate data arrivals seconds apart, so the repeats land well
 * outside the transport window. The gate has to be a real freshness window at
 * the slice seam, which is what `createCachedFetch` is
 * (`src/lib/async/createCachedFetch.ts` — the same primitive `credentialSlice`
 * and `teamSlice` adopt).
 *
 * TTL = CHANNEL_POLL_MS: inside one poll cadence a re-subscribe cannot learn
 * anything the shared service is not already about to deliver. The poll
 * (`refreshSubscribedChannels`) and the push path (TEAM_ASSIGNMENT_PROGRESS,
 * via `refreshChannel` directly) deliberately BYPASS this controller — gating
 * a 15s poll behind a 15s window would make it skip ticks, and throttling a
 * push refresh to 15s would make a live channel feel dead. The one cost is
 * that `refreshChannel` swallows its own errors and resolves, so a head fetch
 * that FAILED is recorded as fresh and a re-subscribe will not retry it; the
 * ungated poll retries within CHANNEL_POLL_MS anyway.
 */
const subscribeHeadFetch = createCachedFetch<string>({ ttlMs: CHANNEL_POLL_MS });

/** Drop every recorded subscribe-time head fetch. For tests. */
export function clearChannelHeadCache(): void {
  subscribeHeadFetch.invalidate();
}


/** Cache key. `kinds` is order-insensitive; empty = the blended read. */
export function channelKey(teamId: string, kinds?: ChannelKind[]): string {
  const k = kinds && kinds.length ? [...kinds].sort().join(",") : "";
  return `${teamId}|${k}`;
}

function parseKey(key: string): { teamId: string; kinds: ChannelKind[] | undefined } {
  const bar = key.indexOf("|");
  const teamId = key.slice(0, bar);
  const rest = key.slice(bar + 1);
  return { teamId, kinds: rest ? (rest.split(",") as ChannelKind[]) : undefined };
}

export interface ChannelTeamState {
  items: TeamChannelItem[];
  loaded: boolean;
  /** No older rows exist — the start of this channel's history. */
  exhausted: boolean;
  posting: boolean;
  /** Newest `at` the user has actually looked at (D6). Null = never. */
  lastSeenAt: string | null;
}

export const EMPTY_CHANNEL: ChannelTeamState = {
  items: [],
  loaded: false,
  exhausted: false,
  posting: false,
  lastSeenAt: null,
};

function readLastSeen(teamId: string): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_PREFIX + teamId);
  } catch {
    return null;
  }
}

function writeLastSeen(teamId: string, at: string): void {
  try {
    localStorage.setItem(LAST_SEEN_PREFIX + teamId, at);
  } catch (e) {
    // Private-mode / quota. Unread still works this session; it just won't
    // survive a restart — worth a breadcrumb rather than a silent shrug.
    silentCatch("teams/channel:last-seen-write")(e);
  }
}

/**
 * Unread = items newer than the last-seen watermark that the user did not write.
 * A never-read team counts as fully unread, which is what a messenger sidebar
 * should show on first run.
 *
 * Bridged `slack` rows DO count: they are other people talking into the channel,
 * which is the single most unread-worthy thing that can arrive. Only the user's
 * own directives are excluded — you never have unread mail from yourself.
 */
export function countUnread(state: ChannelTeamState): number {
  let n = 0;
  for (const i of state.items) {
    if (i.kind === "directive") continue; // the user's own posts
    if (state.lastSeenAt !== null && i.at <= state.lastSeenAt) continue;
    n += 1;
  }
  return n;
}

/**
 * THE MERGE HORIZON — the deepest timestamp a cross-team merge can honestly show.
 *
 * The Stream is a k-way merge of independently-paged lists. Team A may be loaded
 * back to Monday while team B only reaches Friday: BELOW Friday the merge is
 * incomplete, because B has rows down there we haven't fetched yet. Render them
 * anyway and B's rows appear ABOVE the user's scroll position on the next page —
 * the classic merge-paging jitter, where history rewrites itself as you read it.
 *
 * So the horizon is the NEWEST of the per-team oldest rows, over the teams that
 * still have history. Rows at or above it are provably complete; anything older
 * is held back until every team has paged past it. When all teams are exhausted
 * the horizon lifts (null) and the whole merge renders.
 */
/**
 * STRUCTURAL REFRESH — reuse the cached row object whenever the server sent
 * the same fact again.
 *
 * The head refresh runs every 15s and after every progress event, and the
 * server almost always returns rows we already hold. Minting fresh objects for
 * them (what this slice did before C1) destroyed identity for every row on
 * every poll, so `memo`'d rows never bailed out and every channel surface
 * repainted on a no-op tick. All `TeamChannelItem` fields are primitives except
 * `consumers` (string[]), so equality is a flat field walk — no deep compare.
 */
function sameItem(a: TeamChannelItem, b: TeamChannelItem): boolean {
  if (
    a.id !== b.id || a.kind !== b.kind || a.at !== b.at || a.personaId !== b.personaId ||
    a.label !== b.label || a.body !== b.body || a.assignmentId !== b.assignmentId ||
    a.stepId !== b.stepId || a.extra !== b.extra || a.replyTo !== b.replyTo ||
    a.deliberationId !== b.deliberationId || a.importance !== b.importance
  ) return false;
  const ac = a.consumers, bc = b.consumers;
  if (ac === bc) return true;
  if (!ac || !bc || ac.length !== bc.length) return false;
  for (let i = 0; i < ac.length; i++) if (ac[i] !== bc[i]) return false;
  return true;
}

/**
 * Merge a fresh head page over the cached items, preserving object identity:
 * a row whose fields are unchanged keeps its previous object, and if NOTHING
 * changed the previous array itself is returned — the caller can then skip the
 * store write entirely and no subscriber re-renders.
 *
 * Generic over the item type (C1's structural refresh is shared with the
 * persona channel slice, whose `PersonaChannelItem` has different fields — the
 * caller supplies the field-walk equality).
 */
export function mergeHeadBy<T extends { id: string; at: string }>(
  prev: T[],
  head: T[],
  same: (a: T, b: T) => boolean,
): T[] {
  const prevById = new Map(prev.map((i) => [i.id, i]));
  const seen = new Set(head.map((i) => i.id));
  const oldest = head[head.length - 1]?.at;
  const next: T[] = head.map((i) => {
    const old = prevById.get(i.id);
    return old && same(old, i) ? old : i;
  });
  for (const i of prev) {
    if (!seen.has(i.id) && (oldest === undefined || i.at <= oldest)) next.push(i);
  }
  if (next.length === prev.length && next.every((i, idx) => i === prev[idx])) return prev;
  return next;
}

export function mergeHead(prev: TeamChannelItem[], head: TeamChannelItem[]): TeamChannelItem[] {
  return mergeHeadBy(prev, head, sameItem);
}

export function mergeHorizon(states: ChannelTeamState[]): string | null {
  let horizon: string | null = null;
  for (const s of states) {
    if (s.exhausted) continue; // no more history — this team can't surprise us
    const oldest = s.items[s.items.length - 1]?.at;
    if (!oldest) continue;
    if (horizon === null || oldest > horizon) horizon = oldest;
  }
  return horizon;
}

export interface ChannelSlice {
  // State
  /** Per-(team, kinds) cache. Keyed by `channelKey`. */
  channels: Record<string, ChannelTeamState>;
  /** Refcount of live subscribers per key. Drives what the service polls. */
  channelSubs: Record<string, number>;
  /** Server-side per-kind row counts, keyed by team id. The facet rail cannot
   *  count rows it never fetched — hence a dedicated count command. */
  channelCounts: Record<string, ChannelKindCounts>;

  // Actions
  /** Subscribe a surface to a (team, kinds) channel. Returns the release fn. */
  subscribeChannel: (teamId: string, kinds?: ChannelKind[]) => () => void;
  refreshChannel: (key: string) => Promise<void>;
  refreshSubscribedChannels: () => Promise<void>;
  /** Keyset-page one screen of older history for one key. */
  loadOlderChannel: (key: string) => Promise<void>;
  /**
   * Page the cross-team merge one screen deeper. Deepens the SHALLOWEST team —
   * the one whose oldest row is newest — because that team is what holds the
   * horizon up. Repeated calls walk every team back in step.
   */
  loadOlderMerged: (teamIds: string[], kinds?: ChannelKind[]) => Promise<void>;
  fetchChannelCounts: (teamId: string) => Promise<void>;
  sendChannelDirective: (teamId: string, content: string, replyTo?: string) => Promise<void>;
  markChannelSeen: (teamId: string) => void;
}

export const createChannelSlice: StateCreator<PipelineStore, [], [], ChannelSlice> = (set, get) => ({
  channels: {},
  channelSubs: {},
  channelCounts: {},

  subscribeChannel: (teamId, kinds) => {
    const key = channelKey(teamId, kinds);
    const prior = get().channelSubs[key] ?? 0;
    set((s) => ({ channelSubs: { ...s.channelSubs, [key]: (s.channelSubs[key] ?? 0) + 1 } }));

    if (prior === 0) {
      if (!get().channels[key]) {
        set((s) => ({
          channels: { ...s.channels, [key]: { ...EMPTY_CHANNEL, lastSeenAt: readLastSeen(teamId) } },
        }));
      }
      // Freshness-gated — see `subscribeHeadFetch` above. A cold key always
      // fetches (nothing recorded); a key re-taken inside one poll cadence
      // does not.
      void subscribeHeadFetch.run(key, () => get().refreshChannel(key));
      if (!get().channelCounts[teamId]) void get().fetchChannelCounts(teamId);
    }

    let released = false;
    return () => {
      if (released) return; // idempotent — StrictMode double-invokes cleanups
      released = true;
      set((s) => {
        const next = (s.channelSubs[key] ?? 1) - 1;
        const subs = { ...s.channelSubs };
        if (next <= 0) delete subs[key];
        else subs[key] = next;
        return { channelSubs: subs };
      });
    };
  },

  refreshChannel: async (key) => {
    const { teamId, kinds } = parseKey(key);
    try {
      const head = await listTeamChannel(teamId, CHANNEL_PAGE, undefined, kinds);
      set((s) => {
        const prev = s.channels[key] ?? { ...EMPTY_CHANNEL, lastSeenAt: readLastSeen(teamId) };
        const items = mergeHead(prev.items, head);
        // A short FIRST page is the whole channel — nothing older exists.
        // Without this, a team with 3 rows never becomes `exhausted`, and
        // it would pin the merge horizon at its own oldest row forever,
        // hiding every other team's history below that point.
        const exhausted =
          prev.items.length === 0 && head.length < CHANNEL_PAGE ? true : prev.exhausted;
        // Identity-preserving no-op: the routine poll usually returns exactly
        // what we hold. Keeping `s.channels` itself untouched means every
        // subscriber's selector bails and a quiet tick costs zero renders.
        if (items === prev.items && prev.loaded && exhausted === prev.exhausted) return {};
        return {
          channels: {
            ...s.channels,
            [key]: { ...prev, items, loaded: true, exhausted },
          },
        };
      });
    } catch (e) {
      silentCatch("teams/channel:head")(e);
    }
  },

  refreshSubscribedChannels: async () => {
    const keys = Object.keys(get().channelSubs);
    await Promise.all(keys.map((k) => get().refreshChannel(k)));
  },

  loadOlderChannel: async (key) => {
    const { teamId, kinds } = parseKey(key);
    const state = get().channels[key];
    const oldest = state?.items[state.items.length - 1];
    if (!oldest || state?.exhausted) return;
    try {
      // COMPOSITE cursor (at, id) — `at` is only second-resolution, so paging on
      // the timestamp alone silently dropped rows sharing the boundary second.
      const older = await listTeamChannel(
        teamId,
        CHANNEL_PAGE,
        { at: oldest.at, id: oldest.id },
        kinds,
      );
      set((s) => {
        const prev = s.channels[key];
        if (!prev) return {};
        const known = new Set(prev.items.map((i) => i.id));
        return {
          channels: {
            ...s.channels,
            [key]: {
              ...prev,
              items: [...prev.items, ...older.filter((i) => !known.has(i.id))],
              exhausted: older.length < CHANNEL_PAGE,
            },
          },
        };
      });
    } catch (e) {
      silentCatch("teams/channel:older")(e);
    }
  },

  loadOlderMerged: async (teamIds, kinds) => {
    const { channels } = get();
    // The shallowest team is what holds the horizon up — deepen that one.
    let target: string | null = null;
    let shallowest: string | null = null;
    for (const teamId of teamIds) {
      const key = channelKey(teamId, kinds);
      const s = channels[key];
      if (!s || s.exhausted) continue;
      const oldest = s.items[s.items.length - 1]?.at;
      if (!oldest) continue;
      if (shallowest === null || oldest > shallowest) {
        shallowest = oldest;
        target = key;
      }
    }
    if (target) await get().loadOlderChannel(target);
  },

  fetchChannelCounts: async (teamId) => {
    try {
      const counts = await countTeamChannelKinds(teamId);
      set((s) => ({ channelCounts: { ...s.channelCounts, [teamId]: counts } }));
    } catch (e) {
      silentCatch("teams/channel:counts")(e);
    }
  },

  sendChannelDirective: async (teamId, content, replyTo) => {
    const text = content.trim();
    if (!text) return;
    const key = channelKey(teamId);
    const patch = (posting: boolean) =>
      set((s) => {
        const prev = s.channels[key];
        if (!prev) return {};
        return { channels: { ...s.channels, [key]: { ...prev, posting } } };
      });
    patch(true);
    try {
      await postTeamDirective(teamId, text, replyTo);
      await get().refreshChannel(key);
    } finally {
      patch(false);
    }
  },

  markChannelSeen: (teamId) => {
    const key = channelKey(teamId);
    const state = get().channels[key];
    const newest = state?.items[0]?.at;
    if (!newest || state?.lastSeenAt === newest) return;
    writeLastSeen(teamId, newest);
    set((s) => {
      const prev = s.channels[key];
      if (!prev) return {};
      return { channels: { ...s.channels, [key]: { ...prev, lastSeenAt: newest } } };
    });
  },
});
