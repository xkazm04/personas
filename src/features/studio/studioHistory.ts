import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BuildPhase } from './studioBuildModel';
import type { StudioMessage } from './studioStore';

// Persisted, per-project Studio history. The live dev server + Claude build
// session already resume server-side after an app restart; this restores the
// DISPLAY state that lives only in the in-memory runtime — the checklist and the
// log of what Athena did — so re-opening a historic project from the toolbar
// brings it back instead of showing a blank plan. Backed by localStorage (the
// app's standard zustand `persist` pattern).
export interface StudioHistoryEntry {
  phases: BuildPhase[];
  messages: StudioMessage[];
  reply: string | null;
  question: string | null;
  options: string[];
  updatedAt: number;
}

// Bound the stored log so a long autonomous build can't grow localStorage without
// limit; the most recent turns are what's worth restoring.
const MAX_MESSAGES = 60;

interface StudioHistoryStore {
  byProject: Record<string, StudioHistoryEntry>;
  save: (id: string, entry: StudioHistoryEntry) => void;
  clear: (id: string) => void;
}

export const useStudioHistory = create<StudioHistoryStore>()(
  persist(
    (set) => ({
      byProject: {},
      save: (id, entry) =>
        set((s) => ({
          byProject: {
            ...s.byProject,
            [id]: { ...entry, messages: entry.messages.slice(-MAX_MESSAGES) },
          },
        })),
      clear: (id) =>
        set((s) => {
          const { [id]: _gone, ...rest } = s.byProject;
          return { byProject: rest };
        }),
    }),
    { name: 'studio-history-v1' },
  ),
);
