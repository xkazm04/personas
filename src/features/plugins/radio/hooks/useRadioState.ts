import { useEffect, useState } from 'react';
// eslint-disable-next-line no-restricted-imports -- the radio widget subscribes to native now-playing events; lifting this would require relocating the entire radio feature out of shared/layout, which is out of scope for this lint pass.
import { listen } from '@tauri-apps/api/event';
import type { NowPlaying } from '@/lib/bindings/NowPlaying';
import type { RadioState } from '@/lib/bindings/RadioState';
import type { Station } from '@/lib/bindings/Station';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
import { getNowPlaying, getRadioState, listStations } from '@/api/radio';

interface RadioSnapshot {
  state: RadioState | null;
  nowPlaying: NowPlaying | null;
  stations: Station[];
  loaded: boolean;
}

const initial: RadioSnapshot = {
  state: null,
  nowPlaying: null,
  stations: [],
  loaded: false,
};

/** Identifier used to detect "the underlying source/track changed" so we
 * know when to refetch `nowPlaying`. For YouTube stations the cursor
 * advances within the same station, so the station id alone isn't enough. */
function trackKey(state: RadioState | null): string {
  if (!state?.currentStationId) return '';
  const cursor = state.stationCursors?.[state.currentStationId];
  return `${state.currentStationId}:${cursor?.currentTrackIndex ?? -1}`;
}

/**
 * Subscribes to `radio:state` events and exposes the latest snapshot.
 * Refetches `nowPlaying` when station id OR (for YouTube) cursor index
 * changes so the renderer always has fresh `track` metadata.
 */
export function useRadioState(): RadioSnapshot {
  const [snap, setSnap] = useState<RadioSnapshot>(initial);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    // Track changes can arrive in bursts (a run of blacklisted tracks skipped
    // back to back), and IPC replies are not ordered: only the newest
    // now-playing read may land, or an older track overwrites the current one.
    const nowPlayingReads = createLatestWins();
    // What the last snapshot held, kept here so the refresh decision is made
    // outside the state updater (updaters must stay pure: StrictMode runs
    // them twice).
    let lastState: RadioState | null = null;
    let haveNowPlaying = false;

    const refreshNowPlaying = async () => {
      const token = nowPlayingReads.next();
      try {
        const np = await getNowPlaying();
        if (cancelled || !nowPlayingReads.isCurrent(token)) return;
        haveNowPlaying = np !== null;
        setSnap((s) => ({ ...s, nowPlaying: np }));
      } catch (e) {
        silentCatch('radio:refresh-now-playing')(e);
      }
    };

    (async () => {
      const token = nowPlayingReads.next();
      try {
        const [state, np, stations] = await Promise.all([
          getRadioState(),
          getNowPlaying(),
          listStations(),
        ]);
        if (cancelled) return;
        lastState = state;
        const current = nowPlayingReads.isCurrent(token);
        if (current) haveNowPlaying = np !== null;
        setSnap((s) => ({ state, nowPlaying: current ? np : s.nowPlaying, stations, loaded: true }));
      } catch (e) {
        silentCatch('radio:initial-load')(e);
        if (!cancelled) setSnap((s) => ({ ...s, loaded: true }));
      }
      if (cancelled) return;

      const fn = await listen<RadioState>('radio:state', (event) => {
        if (cancelled) return;
        const next = event.payload;
        const refresh = trackKey(lastState) !== trackKey(next) || !haveNowPlaying;
        lastState = next;
        setSnap((prev) => ({ ...prev, state: next }));
        if (refresh) void refreshNowPlaying();
      });
      // Unmounted while the listener was attaching: release it now, or it
      // outlives the component (every StrictMode mount, every fast remount).
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return snap;
}
