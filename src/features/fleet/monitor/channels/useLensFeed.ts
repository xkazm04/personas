import { useCallback, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
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

  // C2: subscribe to THIS lens's cache entries, not the whole channels map.
  // With the whole-map selector, any other team's (or the deliberation key's)
  // poll re-rendered the Stream. useShallow over the per-key array bails when
  // every entry kept identity — which C1's structural refresh guarantees on a
  // quiet tick.
  const keys = useMemo(
    () => teams.map((tm) => channelKey(tm.teamId, stableKinds)),
    [teams, stableKinds],
  );
  const states = usePipelineStore(
    useShallow((s) => keys.map((k) => s.channels[k])),
  );

  // Per-team TaggedItem wrappers, cached by (team, items) identity. Without
  // this, one team's new row re-minted EVERY team's wrappers and the memo'd
  // StreamRow never bailed for the untouched teams.
  const tagCache = useRef(
    new Map<string, { items: ChannelTeamState['items']; team: FeedTeam; rows: TaggedItem[] }>(),
  );

  const { rows, loading, hasMore } = useMemo(() => {
    const live: ChannelTeamState[] = [];
    const flat: TaggedItem[] = [];
    const cache = tagCache.current;
    const seen = new Set<string>();

    teams.forEach((team, i) => {
      const st = states[i];
      if (!st) return;
      live.push(st);
      seen.add(team.teamId);
      const hit = cache.get(team.teamId);
      let tagged: TaggedItem[];
      if (hit && hit.items === st.items && hit.team === team) {
        tagged = hit.rows;
      } else {
        tagged = st.items.map((item) => ({ item, team }));
        cache.set(team.teamId, { items: st.items, team, rows: tagged });
      }
      for (const r of tagged) flat.push(r);
    });
    for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);

    // Same comparator the server ranks by — (at, id) desc. The merge must sort
    // identically or paging would interleave wrongly. (A k-way head merge was
    // considered and declined: this only runs when something actually changed
    // now, and the loaded window is a few hundred rows.)
    flat.sort((a, b) => b.item.at.localeCompare(a.item.at) || b.item.id.localeCompare(a.item.id));

    const horizon = mergeHorizon(live);
    const visible = horizon === null ? flat : flat.filter((r) => r.item.at >= horizon);

    return {
      rows: visible,
      loading: live.length === 0 || live.some((s) => !s.loaded),
      hasMore: live.some((s) => !s.exhausted) || visible.length < flat.length,
    };
  }, [teams, states]);

  const loadMore = useCallback(() => {
    void loadOlderMerged(teamIds, stableKinds);
  }, [loadOlderMerged, teamIds, stableKinds]);

  return { rows, loading, hasMore, loadMore, counts };
}
