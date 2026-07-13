import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";

import {
  listTeamChannel,
  postTeamDirective,
  countTeamChannelKinds,
  type ChannelKind,
} from "@/api/pipeline/teamChannel";
import { silentCatch } from "@/lib/silentCatch";
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
      void get().refreshChannel(key);
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
        const seen = new Set(head.map((i) => i.id));
        const oldest = head[head.length - 1]?.at;
        const olderTail = prev.items.filter(
          (i) => !seen.has(i.id) && (oldest === undefined || i.at <= oldest),
        );
        return {
          channels: {
            ...s.channels,
            [key]: {
              ...prev,
              items: [...head, ...olderTail],
              loaded: true,
              // A short FIRST page is the whole channel — nothing older exists.
              // Without this, a team with 3 rows never becomes `exhausted`, and
              // it would pin the merge horizon at its own oldest row forever,
              // hiding every other team's history below that point.
              exhausted:
                prev.items.length === 0 && head.length < CHANNEL_PAGE ? true : prev.exhausted,
            },
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
