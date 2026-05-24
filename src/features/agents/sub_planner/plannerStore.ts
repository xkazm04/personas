/**
 * Goal-to-Plan — persisted planner state.
 *
 * Remembers the last goal and a short history of recent goals so reopening
 * the Plan surface restores the user's draft instead of a blank box. Also
 * carries a transient `prefillGoal` slot used to hand a goal in from another
 * surface (e.g. the build composer's "Plan this first" action) — that slot
 * is intentionally NOT persisted; it's a one-shot handoff.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createDedupedJSONStorage } from '@/stores/util/dedupedStorage';

const MAX_RECENT = 6;

interface PlannerStore {
  /** The goal text from the last preview — restored on mount. */
  lastGoal: string;
  /** Most-recent-first list of distinct goals (capped). */
  recentGoals: string[];
  /** One-shot goal handed in from another surface. Not persisted. */
  prefillGoal: string | null;

  /** Record a goal after a preview: set as last + prepend into recents. */
  rememberGoal: (goal: string) => void;
  /** Stash a goal for the planner to pick up on its next mount. */
  setPrefill: (goal: string) => void;
  /** Return and clear the prefill slot (one-shot). */
  consumePrefill: () => string | null;
  /** Forget the recent-goal history. */
  clearRecent: () => void;
}

export const usePlannerStore = create<PlannerStore>()(
  persist(
    (set, get) => ({
      lastGoal: '',
      recentGoals: [],
      prefillGoal: null,

      rememberGoal: (goal) => {
        const clean = goal.trim();
        if (!clean) return;
        set((s) => ({
          lastGoal: clean,
          recentGoals: [clean, ...s.recentGoals.filter((g) => g !== clean)].slice(0, MAX_RECENT),
        }));
      },
      setPrefill: (goal) => set({ prefillGoal: goal.trim() || null }),
      consumePrefill: () => {
        const g = get().prefillGoal;
        if (g !== null) set({ prefillGoal: null });
        return g;
      },
      clearRecent: () => set({ recentGoals: [] }),
    }),
    {
      name: 'persona-planner',
      storage: createDedupedJSONStorage(),
      // Persist only the durable fields — prefillGoal is a transient handoff.
      partialize: (s) => ({ lastGoal: s.lastGoal, recentGoals: s.recentGoals }),
    },
  ),
);
