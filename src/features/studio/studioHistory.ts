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
  /**
   * Ids of the tabs currently open in Studio, + which is active (H10). The live
   * runtime (`useStudioStore`) is in-memory and is wiped by a WebView reload —
   * which the app does mid-turn (freeze-recovery / full Vite reload), silently
   * dropping the user's open project even though its dev server (a Rust process)
   * is still alive. Persisting the open-tab set here lets Studio re-hydrate the
   * tabs on mount and re-attach to the running servers instead of showing a
   * blank "no project open" screen.
   */
  openTabIds: string[];
  activeTabId: string | null;
  save: (id: string, entry: StudioHistoryEntry) => void;
  clear: (id: string) => void;
  setOpenTabs: (ids: string[], activeId: string | null) => void;
}

export const useStudioHistory = create<StudioHistoryStore>()(
  persist(
    (set) => ({
      byProject: {},
      openTabIds: [],
      activeTabId: null,
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
      setOpenTabs: (ids, activeId) => set({ openTabIds: ids, activeTabId: activeId }),
    }),
    { name: 'studio-history-v1' },
  ),
);
