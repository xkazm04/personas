import { useMemo, type ReactNode } from 'react';
import { usePipelineStore } from '@/stores/pipelineStore';
import { derivePresence, useChannelSubscription } from '@/features/teams/sub_collab/useTeamChannel';
import { MAX_MERGED_ROWS, type FeedTeam, type TaggedItem, type PresenceMap } from './types';

/* ----------------------------------------------------------------------------
 * Merge infrastructure for the combined cross-team channel views.
 *
 * P0 (monitor consolidation): this used to mount one hidden `TeamFeed` component
 * per team, each running `useTeamChannel` — which meant its own 15s poll and its
 * own TEAM_ASSIGNMENT_PROGRESS listener. With the shared `channelSlice`, the
 * feeders are gone: we declare interest in the teams (refcounted) and read the
 * merged result straight out of the store. Two surfaces watching the same team
 * now cost one fetch, not two.
 *
 * The combined views stay READ-ONLY (click a row → the shared detail modal);
 * full per-team interaction lives in the grid layout.
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
    // Bound the merged window so memory + the virtualizer stay cheap no matter
    // how many teams are selected. The newest MAX_MERGED_ROWS are kept; the
    // virtualized list only ever mounts the visible slice of these.
    // (P2 replaces this cap with a k-way merge cursor + real paging.)
    const merged = flat.length > MAX_MERGED_ROWS ? flat.slice(0, MAX_MERGED_ROWS) : flat;
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
