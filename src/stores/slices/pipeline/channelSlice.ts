import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";

import { listTeamChannel, postTeamDirective } from "@/api/pipeline/teamChannel";
import { silentCatch } from "@/lib/silentCatch";
import type { TeamChannelItem } from "@/lib/bindings/TeamChannelItem";

/* ----------------------------------------------------------------------------
 * CHANNEL SLICE — the single owner of team-channel state.
 *
 * Before this slice, three surfaces each mounted their own per-team feed hook:
 * the monitor's channel grid (one per selected team), the merged timeline (one
 * per team again), and LiveChannelOverlay at App root (one per team, always).
 * Each carried its own 15s poll and its own TEAM_ASSIGNMENT_PROGRESS listener,
 * so watching N teams from the monitor while live pop-ups were enabled meant 3N
 * polls and 3N listeners for the same rows.
 *
 * Now: surfaces `subscribeChannel(teamId)` (refcounted), the cache lives here,
 * and exactly one poll loop + one push listener — `useChannelService`, mounted
 * once in BackgroundServices — refreshes whatever is currently subscribed. N
 * surfaces on the same team share one fetch.
 *
 * See docs/plans/monitor-consolidation.md § Pillar 0.
 * -------------------------------------------------------------------------- */

/** Rows fetched per page (head refresh and keyset older-pages alike). */
export const CHANNEL_PAGE = 60;

/** Poll cadence for the sources that have no push channel (bus events,
 *  memories). Step movement arrives immediately via TEAM_ASSIGNMENT_PROGRESS. */
export const CHANNEL_POLL_MS = 15_000;

const LAST_SEEN_PREFIX = "personas.channel.lastSeen.";

/** Per-team channel cache. */
export interface ChannelTeamState {
  items: TeamChannelItem[];
  /** True once the head page has landed at least once. */
  loaded: boolean;
  /** True once a keyset page came back empty — start of conversation. */
  exhausted: boolean;
  /** A directive post is in flight. */
  posting: boolean;
  /** Newest `item.at` the user has actually looked at (D6). Null = never. */
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
 * Unread = items newer than the last-seen watermark that the user did not write
 * themselves. A team never read before counts as fully unread, which is what a
 * messenger sidebar should show on first run.
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

export interface ChannelSlice {
  // State
  /** Per-team channel cache. Keyed by team_id. */
  channels: Record<string, ChannelTeamState>;
  /** Refcount of live subscribers per team. Drives what the service polls. */
  channelSubs: Record<string, number>;

  // Actions
  /** Subscribe a surface to a team's channel. Returns the release function —
   *  call it on unmount. The first subscriber triggers an immediate fetch; the
   *  cache survives the last release (warm for the next open). */
  subscribeChannel: (teamId: string) => () => void;
  /** Refresh the head page and merge it over what's already loaded. */
  refreshChannel: (teamId: string) => Promise<void>;
  /** Refresh every currently-subscribed team. The service's only entry point. */
  refreshSubscribedChannels: () => Promise<void>;
  /** Keyset-page one screen of older history. */
  loadOlderChannel: (teamId: string) => Promise<void>;
  /** Post a user directive, then refresh the head so receipts land. */
  sendChannelDirective: (teamId: string, content: string, replyTo?: string) => Promise<void>;
  /** Mark the channel read up to its newest row (D6). */
  markChannelSeen: (teamId: string) => void;
}

export const createChannelSlice: StateCreator<PipelineStore, [], [], ChannelSlice> = (set, get) => ({
  channels: {},
  channelSubs: {},

  subscribeChannel: (teamId) => {
    const prior = get().channelSubs[teamId] ?? 0;
    set((s) => ({ channelSubs: { ...s.channelSubs, [teamId]: (s.channelSubs[teamId] ?? 0) + 1 } }));

    if (prior === 0) {
      // First subscriber: seed the cache entry (hydrating the persisted
      // last-seen watermark) and fetch immediately rather than waiting out a
      // poll tick.
      if (!get().channels[teamId]) {
        set((s) => ({
          channels: {
            ...s.channels,
            [teamId]: { ...EMPTY_CHANNEL, lastSeenAt: readLastSeen(teamId) },
          },
        }));
      }
      void get().refreshChannel(teamId);
    }

    let released = false;
    return () => {
      if (released) return; // idempotent — StrictMode double-invokes cleanups
      released = true;
      set((s) => {
        const next = (s.channelSubs[teamId] ?? 1) - 1;
        const subs = { ...s.channelSubs };
        if (next <= 0) delete subs[teamId];
        else subs[teamId] = next;
        return { channelSubs: subs };
      });
    };
  },

  refreshChannel: async (teamId) => {
    try {
      const head = await listTeamChannel(teamId, CHANNEL_PAGE);
      set((s) => {
        const prev = s.channels[teamId] ?? { ...EMPTY_CHANNEL, lastSeenAt: readLastSeen(teamId) };
        // Merge the fresh head over the loaded window, keeping older pages that
        // the head no longer covers.
        const seen = new Set(head.map((i) => i.id));
        const oldest = head[head.length - 1]?.at;
        const olderTail = prev.items.filter(
          (i) => !seen.has(i.id) && (oldest === undefined || i.at <= oldest),
        );
        return {
          channels: {
            ...s.channels,
            [teamId]: { ...prev, items: [...head, ...olderTail], loaded: true },
          },
        };
      });
    } catch (e) {
      silentCatch("teams/channel:head")(e);
    }
  },

  refreshSubscribedChannels: async () => {
    const teamIds = Object.keys(get().channelSubs);
    await Promise.all(teamIds.map((id) => get().refreshChannel(id)));
  },

  loadOlderChannel: async (teamId) => {
    const state = get().channels[teamId];
    const oldest = state?.items[state.items.length - 1];
    if (!oldest || state?.exhausted) return;
    try {
      // COMPOSITE cursor (at, id) — `at` is only second-resolution, so paging on
      // the timestamp alone silently dropped rows that shared the boundary
      // second with the last item of the previous page.
      const older = await listTeamChannel(teamId, CHANNEL_PAGE, { at: oldest.at, id: oldest.id });
      set((s) => {
        const prev = s.channels[teamId];
        if (!prev) return {};
        const known = new Set(prev.items.map((i) => i.id));
        return {
          channels: {
            ...s.channels,
            [teamId]: {
              ...prev,
              items: [...prev.items, ...older.filter((i) => !known.has(i.id))],
              exhausted: older.length === 0,
            },
          },
        };
      });
    } catch (e) {
      silentCatch("teams/channel:older")(e);
    }
  },

  sendChannelDirective: async (teamId, content, replyTo) => {
    const text = content.trim();
    if (!text) return;
    const patch = (posting: boolean) =>
      set((s) => {
        const prev = s.channels[teamId];
        if (!prev) return {};
        return { channels: { ...s.channels, [teamId]: { ...prev, posting } } };
      });
    patch(true);
    try {
      await postTeamDirective(teamId, text, replyTo);
      await get().refreshChannel(teamId);
    } finally {
      patch(false);
    }
  },

  markChannelSeen: (teamId) => {
    const state = get().channels[teamId];
    const newest = state?.items[0]?.at;
    if (!newest || state?.lastSeenAt === newest) return;
    writeLastSeen(teamId, newest);
    set((s) => {
      const prev = s.channels[teamId];
      if (!prev) return {};
      return { channels: { ...s.channels, [teamId]: { ...prev, lastSeenAt: newest } } };
    });
  },
});
