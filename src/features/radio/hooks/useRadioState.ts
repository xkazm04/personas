import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { NowPlaying } from '@/lib/bindings/NowPlaying';
import type { RadioState } from '@/lib/bindings/RadioState';
import type { Station } from '@/lib/bindings/Station';
import { silentCatch } from '@/lib/silentCatch';
import { getNowPlaying, getRadioState, listStations } from '../api/radioApi';

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

/**
 * Subscribes to `radio:state` events and exposes the latest snapshot.
 * Refetches `nowPlaying` when the current station changes so the footer
 * has fresh station metadata to render.
 */
export function useRadioState(): RadioSnapshot {
  const [snap, setSnap] = useState<RadioSnapshot>(initial);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const refreshNowPlaying = async () => {
      try {
        const np = await getNowPlaying();
        if (!cancelled) setSnap((s) => ({ ...s, nowPlaying: np }));
      } catch (e) {
        silentCatch('radio:refresh-now-playing')(e);
      }
    };

    (async () => {
      try {
        const [state, np, stations] = await Promise.all([
          getRadioState(),
          getNowPlaying(),
          listStations(),
        ]);
        if (cancelled) return;
        setSnap({ state, nowPlaying: np, stations, loaded: true });
      } catch (e) {
        silentCatch('radio:initial-load')(e);
        if (!cancelled) setSnap((s) => ({ ...s, loaded: true }));
      }

      const fn = await listen<RadioState>('radio:state', (event) => {
        if (cancelled) return;
        setSnap((prev) => {
          const next = { ...prev, state: event.payload };
          const prevStationId = prev.state?.currentStationId ?? null;
          const nextStationId = event.payload.currentStationId ?? null;
          if (prevStationId !== nextStationId || !prev.nowPlaying) {
            refreshNowPlaying();
          }
          return next;
        });
      });
      unlisten = fn;
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return snap;
}
