import { useEffect, useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Derives "last bridged X ago" per-channel for the active twin from the
 * twinCommunications slice. ChannelsBaseline renders the result as a badge
 * on each channel card so the user can spot dead channels at a glance.
 *
 * Triggers a single fetch when the active twin changes — bounded to the
 * latest 200 records so the timeline stays cheap even on heavy twins.
 * If a channel has no activity within that window the map omits it; the
 * UI falls back to a "never used" badge for that case.
 */

const RECENT_LIMIT = 200;

export interface ChannelActivity {
  /** Latest `occurred_at` (ISO-8601) per channel_type. */
  lastByChannel: Map<string, string>;
  /** True while the underlying communications fetch is in flight. */
  loading: boolean;
}

export function useChannelActivity(twinId: string | null): ChannelActivity {
  const fetchTwinCommunications = useSystemStore((s) => s.fetchTwinCommunications);
  const twinCommsLoading = useSystemStore((s) => s.twinCommsLoading);
  const twinCommunications = useSystemStore((s) => s.twinCommunications);

  useEffect(() => {
    if (!twinId) return;
    void fetchTwinCommunications(twinId, undefined, RECENT_LIMIT);
  }, [twinId, fetchTwinCommunications]);

  const lastByChannel = useMemo(() => {
    const map = new Map<string, string>();
    if (!twinId) return map;
    for (const c of twinCommunications) {
      if (c.twin_id !== twinId) continue;
      const prev = map.get(c.channel);
      if (!prev || prev < c.occurred_at) {
        map.set(c.channel, c.occurred_at);
      }
    }
    return map;
  }, [twinId, twinCommunications]);

  return { lastByChannel, loading: twinCommsLoading };
}
