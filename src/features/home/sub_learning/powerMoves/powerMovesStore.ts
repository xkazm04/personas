import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { silentCatch } from '@/lib/silentCatch';
import { POWER_MOVES } from './registry';

interface PowerMovesState {
  /** Moves whose "Try it" was clicked — the fallback completion signal. */
  tried: Record<string, true>;
  /** Moves whose `detect()` probe confirmed real usage. Never un-set. */
  done: Record<string, true>;
  markTried: (id: string) => void;
  markDone: (id: string) => void;
}

export const usePowerMovesStore = create<PowerMovesState>()(
  persist(
    (set) => ({
      tried: {},
      done: {},
      markTried: (id) => set((s) => ({ tried: { ...s.tried, [id]: true } })),
      markDone: (id) => set((s) => ({ done: { ...s.done, [id]: true } })),
    }),
    { name: 'power-moves-progress', version: 1 },
  ),
);

/**
 * Runs each registered move's `detect()` probe on mount and promotes hits to
 * `done`. Achievement semantics: once earned, a move stays done (persisted),
 * so probes only run for moves not yet detected — steady state is zero IPC.
 */
export function usePowerMoveDetection(): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const move of POWER_MOVES) {
        if (!move.detect || usePowerMovesStore.getState().done[move.id]) continue;
        try {
          const hit = await move.detect();
          if (cancelled) return;
          if (hit) usePowerMovesStore.getState().markDone(move.id);
        } catch (err) {
          silentCatch(`power-move detect ${move.id}`)(err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
