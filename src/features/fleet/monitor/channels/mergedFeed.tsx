import { useMemo, type ReactNode } from 'react';
import { usePipelineStore } from '@/stores/pipelineStore';
import { derivePresence, useChannelSubscription } from '@/features/teams/sub_collab/useTeamChannel';
import { LIVE_FEED_WINDOW, type FeedTeam, type TaggedItem, type PresenceMap } from './types';

/* ----------------------------------------------------------------------------
 * Merge infrastructure for the combined cross-team channel views.
 *
 * P0: this used to mount one hidden `TeamFeed` component per team, each running
 * `useTeamChannel` — its own 15s poll and its own TEAM_ASSIGNMENT_PROGRESS
 * listener apiece. With the shared `channelSlice` the feeders are gone: we
 * declare interest (refcounted) and read the merged result out of the store.
 *
 * P2: the Stream stopped using this entirely — it reads (team, kinds) cache
 * entries and pages a real k-way merge. The ONLY consumer left is
 * LiveChannelOverlay, which diffs recent arrivals into corner pop-ups.
 * -------------------------------------------------------------------------- */

/** Merge every subscribed team's cached channel into one newest-first stream. */
export function useMergedChannels(teams: FeedTeam[]): {
  merged: TaggedItem[];
  presenceByTeam: Map<string, PresenceMap>;
  byTeam: Map<string, TaggedItem[]>;
} {
  useChannelSubscription(useMemo(() => teams.map((t) => t.teamId), [teams]));

  const channels = usePipelineStore((s) => s.channels);

  return useMemo(() => {
    const flat: TaggedItem[] = [];
    const byTeam = new Map<string, TaggedItem[]>();
    const presenceByTeam = new Map<string, PresenceMap>();

    for (const team of teams) {
      const items = channels[team.teamId]?.items ?? [];
      const rows = items.map((item) => ({ item, team }));
      byTeam.set(team.teamId, rows);
      presenceByTeam.set(team.teamId, derivePresence(items));
      flat.push(...rows);
    }

    flat.sort((a, b) => b.item.at.localeCompare(a.item.at));
    // The pop-up overlay only diffs RECENT arrivals to decide what to pop, so a
    // bounded window is correct here. (The Stream's unbounded history lives in
    // the shared channel cache + its k-way merge — it no longer uses this feed.)
    const merged = flat.length > LIVE_FEED_WINDOW ? flat.slice(0, LIVE_FEED_WINDOW) : flat;
    return { merged, presenceByTeam, byTeam };
  }, [teams, channels]);
}

/** Render-prop wrapper — kept so existing callers didn't have to change. */
export function MergedChannels({
  teams,
  children,
}: {
  teams: FeedTeam[];
  children: (merged: TaggedItem[], presenceByTeam: Map<string, PresenceMap>, byTeam: Map<string, TaggedItem[]>) => ReactNode;
}) {
  const { merged, presenceByTeam, byTeam } = useMergedChannels(teams);
  return <>{children(merged, presenceByTeam, byTeam)}</>;
}
