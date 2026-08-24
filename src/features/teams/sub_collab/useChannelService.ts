import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { usePipelineStore } from '@/stores/pipelineStore';
import { CHANNEL_POLL_MS } from '@/stores/slices/pipeline/channelSlice';

/** Trailing window that folds a progress-event burst into one head refresh. */
const COALESCE_MS = 1_000;

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
  const refreshPersonas = usePipelineStore((s) => s.refreshSubscribedPersonaChannels);
  const notifyPersona = usePipelineStore((s) => s.notifyPersonaChannel);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    // COALESCE the push storm (C1). A running assignment emits progress
    // continuously; refreshing per event multiplied head refetches for no new
    // information. A trailing 1s window folds a burst into one refresh —
    // latency stays ~1s while a step-storm costs one round-trip per second
    // instead of one per event.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (cancelled || pending !== null) return;
      pending = setTimeout(() => {
        pending = null;
        if (!cancelled) void refresh();
      }, COALESCE_MS);
    };

    void listen(EventName.TEAM_ASSIGNMENT_PROGRESS, scheduleRefresh).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });

    // PERSONA_CHANNEL_MESSAGE — the persona conversations' push path. Coalesced
    // like the progress storm above, but PER PERSONA: the payload names one
    // persona, so a burst refreshes only the channels it actually changed
    // instead of fanning a head refetch across every subscription.
    let personaUnlisten: (() => void) | null = null;
    let personaPending: ReturnType<typeof setTimeout> | null = null;
    const personaQueue = new Set<string>();
    void listen<{ persona_id: string }>(EventName.PERSONA_CHANNEL_MESSAGE, (e) => {
      if (cancelled || !e.payload?.persona_id) return;
      personaQueue.add(e.payload.persona_id);
      if (personaPending !== null) return;
      personaPending = setTimeout(() => {
        personaPending = null;
        if (cancelled) return;
        const ids = [...personaQueue];
        personaQueue.clear();
        for (const id of ids) void notifyPersona(id);
      }, COALESCE_MS);
    }).then((u) => {
      if (cancelled) u();
      else personaUnlisten = u;
    });

    const timer = setInterval(() => {
      void refresh();
      void refreshPersonas();
    }, CHANNEL_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (pending !== null) clearTimeout(pending);
      if (personaPending !== null) clearTimeout(personaPending);
      if (unlisten) unlisten();
      if (personaUnlisten) personaUnlisten();
    };
  }, [refresh, refreshPersonas, notifyPersona]);
}
