import { useCallback, useMemo } from 'react';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, mergeHorizon, type ChannelTeamState } from '@/stores/slices/pipeline/channelSlice';
import { useChannelSubscription } from '@/features/teams/sub_collab/useTeamChannel';
import type { ChannelKind } from '@/api/pipeline/teamChannel';
import type { ChannelKindCounts } from '@/lib/bindings/ChannelKindCounts';
import type { FeedTeam, TaggedItem } from './types';

/* ----------------------------------------------------------------------------
 * LENS FEED — the Stream's view of the shared channel cache.
 *
 * The kind lens is pushed into SQL (P1), so the Stream subscribes to
 * (team, kinds) cache entries rather than filtering a blended page. That
 * distinction is not cosmetic: filtering blended rows client-side reproduces the
 * exact starvation bug P1 removed — a chatty step layer crowds every memory out
 * of the page, so a memory-only lens renders EMPTY even for a team holding
 * hundreds of memories.
 *
 * Cross-team paging is a k-way merge, so the visible rows stop at the HORIZON —
 * the deepest timestamp every team has provably loaded past. Rendering below it
 * would let a shallower team's rows appear ABOVE the user's scroll position on
 * the next page. `loadMore` deepens the shallowest team, which is exactly what
 * raises the horizon.
 * -------------------------------------------------------------------------- */

export interface LensFeed {
  rows: TaggedItem[];
  loading: boolean;
  /** History remains — either unpaged in some team, or held behind the horizon. */
  hasMore: boolean;
  loadMore: () => void;
  /** Authoritative per-kind counts from SQL — NOT derived from `rows`. */
  counts: Record<string, ChannelKindCounts>;
}

export function useLensFeed(teams: FeedTeam[], kinds: ChannelKind[] | undefined): LensFeed {
  const teamIds = useMemo(() => teams.map((t) => t.teamId), [teams]);
  useChannelSubscription(teamIds, kinds);


  const channels = usePipelineStore((s) => s.channels);
  const counts = usePipelineStore((s) => s.channelCounts);
  const loadOlderMerged = usePipelineStore((s) => s.loadOlderMerged);

  // Callers rebuild `kinds` every render (it's derived from lens state), so its
  // identity is useless as a memo dep — key off the VALUE and rebuild a stable
  // array from it. Without this the merge re-sorted on every single render.
  const kindKey = kinds ? [...kinds].sort().join(',') : '';
  const stableKinds = useMemo(
    () => (kindKey ? (kindKey.split(',') as ChannelKind[]) : undefined),
    [kindKey],
  );

  const { rows, loading, hasMore } = useMemo(() => {
    const states: ChannelTeamState[] = [];
    const flat: TaggedItem[] = [];

    for (const team of teams) {
      const st = channels[channelKey(team.teamId, stableKinds)];
      if (!st) continue;
      states.push(st);
      for (const item of st.items) flat.push({ item, team });
    }

    // Same comparator the server ranks by — (at, id) desc. The merge must sort
    // identically or paging would interleave wrongly.
    flat.sort((a, b) => b.item.at.localeCompare(a.item.at) || b.item.id.localeCompare(a.item.id));

    const horizon = mergeHorizon(states);
    const visible = horizon === null ? flat : flat.filter((r) => r.item.at >= horizon);

    return {
      rows: visible,
      loading: states.length === 0 || states.some((s) => !s.loaded),
      hasMore: states.some((s) => !s.exhausted) || visible.length < flat.length,
    };
  }, [teams, channels, stableKinds]);

  const loadMore = useCallback(() => {
    void loadOlderMerged(teamIds, stableKinds);
  }, [loadOlderMerged, teamIds, stableKinds]);

  return { rows, loading, hasMore, loadMore, counts };
}
