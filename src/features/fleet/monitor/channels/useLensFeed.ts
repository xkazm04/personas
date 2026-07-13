import { useEffect, useMemo, useRef, useState } from 'react';
import { listTeamChannel, type ChannelKind } from '@/api/pipeline/teamChannel';
import { silentCatch } from '@/lib/silentCatch';
import type { FeedTeam, TaggedItem } from './types';

/* ----------------------------------------------------------------------------
 * LENS FEED — fetches the stream with the lens's `kinds` pushed to the server.
 *
 * WHY THIS EXISTS (and isn't just a client-side filter over the shared cache):
 * the shared channel cache is fetched BLENDED. Filtering a blended page down to
 * one kind client-side reproduces exactly the starvation bug P1 removed — a
 * chatty step layer crowds every memory out of the 60-row page, so a
 * memory-only lens renders EMPTY even though the team has hundreds of memories.
 * The kind lens has to reach SQL. That's what `list_team_channel`'s `kinds`
 * param is for (commit ebdd68a09), and this hook is the prototype's use of it.
 *
 * At consolidation this collapses INTO `channelSlice` (a per-(team, kinds)
 * cache entry, sharing the refcounted subscription + the single poll). It is a
 * hook here only so the prototype can prove the shape before it's formalised.
 * Deliberately dumb: refetch on lens change, no cache, no paging.
 * -------------------------------------------------------------------------- */

const PAGE = 200;

export function useLensFeed(teams: FeedTeam[], kinds: ChannelKind[] | undefined) {
  const [rows, setRows] = useState<TaggedItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch by VALUE, not identity — callers rebuild these arrays every render.
  const teamKey = teams.map((t) => t.teamId).join(',');
  const kindKey = kinds ? [...kinds].sort().join(',') : '';
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  useEffect(() => {
    let cancelled = false;
    const active = teamsRef.current;
    if (active.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    const asked: ChannelKind[] | undefined = kindKey ? (kindKey.split(',') as ChannelKind[]) : undefined;

    Promise.all(
      active.map((team) =>
        listTeamChannel(team.teamId, PAGE, undefined, asked)
          .then((items) => items.map((item) => ({ item, team })))
          .catch((e) => {
            silentCatch('monitor/lens-feed')(e);
            return [] as TaggedItem[];
          }),
      ),
    ).then((perTeam) => {
      if (cancelled) return;
      const flat = perTeam.flat();
      // Same comparator the server sorts by: (at, id) descending. The merge has
      // to rank identically or paging would interleave wrongly.
      flat.sort((a, b) => b.item.at.localeCompare(a.item.at) || b.item.id.localeCompare(a.item.id));
      setRows(flat);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [teamKey, kindKey]);

  return useMemo(() => ({ rows, loading }), [rows, loading]);
}
