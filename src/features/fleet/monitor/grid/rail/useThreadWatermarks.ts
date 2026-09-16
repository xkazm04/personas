// useThreadWatermarks — the per-thread read watermark behind the Messages tab.
//
// One ISO instant per thread key: the newest message the operator has had in
// front of them in that thread. Held in a small persisted Zustand store rather
// than read from Web Storage by hand, so every rail instance shares one copy,
// a watermark written by one mount re-renders the other, and persistence goes
// through the repo's storage adapter (`createDedupedJSONStorage`) instead of a
// second hand-rolled get/set path. When storage is unavailable the store still
// holds the watermarks for the session; they just do not survive a restart.
//
// The map is bounded by the number of distinct threads (personas, teams, and
// the one system thread), not by messages.

import { useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createDedupedJSONStorage } from '@/stores/util/dedupedStorage';

interface ThreadSeenState {
  seen: Record<string, string>;
  markSeen: (key: string, at: string) => void;
}

export const useThreadSeenStore = create<ThreadSeenState>()(
  persist(
    (set) => ({
      seen: {},
      markSeen: (key, at) =>
        set((s) => {
          const prev = s.seen[key];
          // Never backwards, and no new object when nothing moved.
          if (prev !== undefined && prev >= at) return s;
          return { seen: { ...s.seen, [key]: at } };
        }),
    }),
    {
      name: 'personas.fleet.rail.thread-seen.v1',
      storage: createDedupedJSONStorage(),
      partialize: (s) => ({ seen: s.seen }),
    },
  ),
);

export interface ThreadWatermarks {
  /** Changes identity whenever any watermark moves. */
  seenOf: (key: string) => string | null;
  /** Advance a thread's watermark to `at`. Never moves it backwards. */
  markSeen: (key: string, at: string) => void;
}

export function useThreadWatermarks(): ThreadWatermarks {
  const seen = useThreadSeenStore((s) => s.seen);
  const markSeen = useThreadSeenStore((s) => s.markSeen);
  const seenOf = useCallback((key: string) => seen[key] ?? null, [seen]);
  return { seenOf, markSeen };
}
