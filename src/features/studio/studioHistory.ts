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

// Bound the number of PROJECTS kept, not just the messages inside each one. The
// per-entry cap alone still let the store grow forever along the other axis: one
// entry per project ever opened, each up to 60 messages, none of them ever
// removed. The picker's "Resume" list is ordered by `updatedAt` and nobody
// scrolls twenty-four projects back, so anything past that is bytes carried on
// every launch for a row no one reads.
const MAX_PROJECTS = 24;

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
  /**
   * Reap everything persisted for a project that no longer exists, and cap the
   * survivors at `MAX_PROJECTS` most-recently-worked.
   *
   * Called with the authoritative project list. Both persisted collections leak
   * without it: `byProject` gained an entry per project ever opened and lost one
   * never, and `rehydrate` stepped over an id whose project was gone while
   * leaving that id in `openTabIds` — so the same dead tab was re-walked on
   * every single launch, forever.
   */
  prune: (liveIds: readonly string[]) => void;
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
      prune: (liveIds) =>
        set((s) => {
          const live = new Set(liveIds);
          // Deleted projects go first, then the oldest of whatever is left over
          // the cap. `updatedAt` is the same ordering the picker's Resume list
          // uses, so what is dropped is exactly what was already off the bottom.
          const keep = Object.entries(s.byProject)
            .filter(([id]) => live.has(id))
            .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0))
            .slice(0, MAX_PROJECTS);
          const byProject = Object.fromEntries(keep);
          const openTabIds = s.openTabIds.filter((id) => live.has(id));
          // Nothing to write is not the same as nothing to check: bail out on an
          // identical result so a prune on every project-list load doesn't churn
          // localStorage (and re-render every subscriber) for no reason.
          if (
            openTabIds.length === s.openTabIds.length &&
            Object.keys(byProject).length === Object.keys(s.byProject).length
          ) {
            return s;
          }
          return {
            byProject,
            openTabIds,
            activeTabId:
              s.activeTabId && live.has(s.activeTabId)
                ? s.activeTabId
                : (openTabIds[openTabIds.length - 1] ?? null),
          };
        }),
      setOpenTabs: (ids, activeId) => set({ openTabIds: ids, activeTabId: activeId }),
    }),
    { name: 'studio-history-v1' },
  ),
);
