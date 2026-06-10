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

/**
 * Channels with no activity past this threshold render with an amber-pulse
 * dot in the atelier — "you forgot about this one, re-test or archive."
 * 30d is the convention for "automation rot is becoming likely": shorter
 * thresholds (7d, 14d) caught too many channels the user only uses for
 * monthly cadences (newsletters, monthly check-ins), longer thresholds
 * (60d, 90d) let truly dead channels stay green for too long.
 */
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export interface ChannelActivity {
  /** Latest `occurred_at` (ISO-8601) per channel_type. */
  lastByChannel: Map<string, string>;
  /** Outbound (sent) communications per channel_type within the recent
   *  window — "how much does the twin actually reply here", not just
   *  when the channel was last touched. */
  sentByChannel: Map<string, number>;
  /**
   * True for any active channel_type whose latest activity is older than
   * `STALE_THRESHOLD_MS`. Channels that have NEVER bridged are NOT marked
   * stale here — the renderer already treats "never used" differently.
   */
  staleByChannel: Map<string, boolean>;
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

  const sentByChannel = useMemo(() => {
    const map = new Map<string, number>();
    if (!twinId) return map;
    for (const c of twinCommunications) {
      if (c.twin_id !== twinId || c.direction !== 'out') continue;
      map.set(c.channel, (map.get(c.channel) ?? 0) + 1);
    }
    return map;
  }, [twinId, twinCommunications]);

  const staleByChannel = useMemo(() => {
    const map = new Map<string, boolean>();
    const now = Date.now();
    for (const [channel, iso] of lastByChannel) {
      const then = Date.parse(iso);
      if (Number.isNaN(then)) continue;
      map.set(channel, now - then >= STALE_THRESHOLD_MS);
    }
    return map;
  }, [lastByChannel]);

  return { lastByChannel, sentByChannel, staleByChannel, loading: twinCommsLoading };
}
