import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { usePipelineStore } from '@/stores/pipelineStore';
import { CHANNEL_POLL_MS } from '@/stores/slices/pipeline/channelSlice';

/**
 * CHANNEL SERVICE — the single refresh driver for every subscribed team channel.
 *
 * Mounted exactly once, in BackgroundServices. It owns:
 *   • one TEAM_ASSIGNMENT_PROGRESS listener — step movement refreshes the head
 *     of every subscribed channel the moment it happens; and
 *   • one poll loop at CHANNEL_POLL_MS — the fallback for the sources that have
 *     no push channel yet (bus events, memories).
 *
 * Previously each of the three channel surfaces mounted its own listener and
 * its own interval *per team*, so watching N teams cost 3N of each. Surfaces now
 * only declare interest via `subscribeChannel`; this hook does the fetching.
 */
export function useChannelService(): void {
  const refresh = usePipelineStore((s) => s.refreshSubscribedChannels);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listen(EventName.TEAM_ASSIGNMENT_PROGRESS, () => {
      if (!cancelled) void refresh();
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });

    const timer = setInterval(() => void refresh(), CHANNEL_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (unlisten) unlisten();
    };
  }, [refresh]);
}
