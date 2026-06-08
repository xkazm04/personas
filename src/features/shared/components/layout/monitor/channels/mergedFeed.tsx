import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTeamChannel } from '@/features/teams/sub_collab/useTeamChannel';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { MAX_MERGED_ROWS, type FeedTeam, type TaggedItem, type PresenceMap } from './types';

/* ----------------------------------------------------------------------------
 * Merge infrastructure for the combined cross-team channel views.
 *
 * `useTeamChannel` is a per-team hook, so a variable number of teams can't be
 * read in a loop. Instead each team gets a hidden `TeamFeed` feeder that calls
 * the hook and reports its items up; `MergedChannels` aggregates them and hands
 * the merged, team-tagged stream to a render-prop child. The combined views are
 * READ-ONLY (click a row → the shared detail modal); full per-team interaction
 * stays in the grid layout.
 * -------------------------------------------------------------------------- */

/** Hidden feeder — one per team — that reports its channel items + presence. */
function TeamFeed({ team, onData }: { team: FeedTeam; onData: (teamId: string, items: TeamChannelItem[], presence: PresenceMap) => void }) {
  const { items, presence } = useTeamChannel(team.teamId);
  useEffect(() => {
    onData(team.teamId, items, presence);
  }, [items, presence, team.teamId, onData]);
  return null;
}

export function MergedChannels({
  teams,
  children,
}: {
  teams: FeedTeam[];
  children: (merged: TaggedItem[], presenceByTeam: Map<string, PresenceMap>, byTeam: Map<string, TaggedItem[]>) => ReactNode;
}) {
  const [itemsByTeam, setItemsByTeam] = useState<Map<string, TeamChannelItem[]>>(new Map());
  const [presenceByTeam, setPresenceByTeam] = useState<Map<string, PresenceMap>>(new Map());

  const onData = useCallback((teamId: string, items: TeamChannelItem[], presence: PresenceMap) => {
    setItemsByTeam((prev) => {
      const next = new Map(prev);
      next.set(teamId, items);
      return next;
    });
    setPresenceByTeam((prev) => {
      const next = new Map(prev);
      next.set(teamId, presence);
      return next;
    });
  }, []);

  const { merged, byTeam } = useMemo(() => {
    const flat: TaggedItem[] = [];
    const grouped = new Map<string, TaggedItem[]>();
    for (const team of teams) {
      const rows = (itemsByTeam.get(team.teamId) ?? []).map((item) => ({ item, team }));
      grouped.set(team.teamId, [...rows].sort((a, b) => b.item.at.localeCompare(a.item.at)));
      flat.push(...rows);
    }
    flat.sort((a, b) => b.item.at.localeCompare(a.item.at));
    // Bound the merged window so memory + the virtualizer stay cheap no matter
    // how many teams are selected. The newest MAX_MERGED_ROWS are kept; the
    // virtualized list only ever mounts the visible slice of these.
    return { merged: flat.length > MAX_MERGED_ROWS ? flat.slice(0, MAX_MERGED_ROWS) : flat, byTeam: grouped };
  }, [teams, itemsByTeam]);

  return (
    <>
      {teams.map((t) => (
        <TeamFeed key={t.teamId} team={t} onData={onData} />
      ))}
      {children(merged, presenceByTeam, byTeam)}
    </>
  );
}
