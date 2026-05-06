import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';

/**
 * Data layer for the **home-page first-run Setup Cards stepper** — the
 * three-step "Role → Tool → Goal" wizard rendered by
 * `src/features/home/components/SetupCards.tsx` (`SetupStepper` modal).
 *
 * Live consumers (verified 2026-05-05):
 * - `SetupCards.tsx` reads all four fields and calls every action; it is
 *   the primary UI surface for this slice.
 * - `UnifiedMatrixEntry.tsx` reads `setupGoal` once on mount as a bridge
 *   to pre-fill the agent-build intent textarea when the user opened
 *   persona creation while onboarding/tour is active; it also calls
 *   `setSetupGoal('')` after promotion to prevent the goal from leaking
 *   into the next build.
 *
 * Persistence: all four fields are partialized in `systemStore.ts` under
 * the `persona-ui-system` localStorage key, so the wizard resumes across
 * app restarts until `dismissSetup()` flips `setupCompleted` to true.
 *
 * NOT to be confused with `onboardingSlice` (the global first-run
 * overlay tour) or `tourSlice` (the guided spotlight tour). Those drive
 * coach-mark walkthroughs of the chrome; this slice owns the user's
 * own answers from the Home setup cards.
 */
export interface SetupSlice {
  /** Role the user picked in step 1 (e.g. "engineer", "founder"); null
   *  means the wizard hasn't completed step 1. Changing the role
   *  cascades to clear `setupTool` and `setupGoal` because the tool
   *  catalog and goal templates differ per role. */
  setupRole: string | null;
  /** Tool picked in step 2 (e.g. "claude", "gpt-5"); null means step 2
   *  hasn't completed (or was invalidated by a role change). */
  setupTool: string | null;
  /** Free-text intent string typed in step 3, also bridged to the
   *  agent-build intent textarea by `UnifiedMatrixEntry`. The stepper
   *  enforces a 10-character minimum before "Finish"; consumers should
   *  not assume non-empty here. */
  setupGoal: string | null;
  /** True once the user has dismissed the setup cards (clicked X or
   *  finished the stepper). When true, `SetupCards` returns null so
   *  the home page reverts to its normal empty/dashboard layout. */
  setupCompleted: boolean;
  setSetupRole: (role: string) => void;
  setSetupTool: (tool: string) => void;
  setSetupGoal: (goal: string) => void;
  /** Permanently hide the setup cards. There is no "un-dismiss" action
   *  by design — once a user has opted out of the wizard, re-showing
   *  it would be a regression. To force the wizard back, clear the
   *  `persona-ui-system` localStorage entry. */
  dismissSetup: () => void;
}

export const createSetupSlice: StateCreator<SystemStore, [], [], SetupSlice> = (set) => ({
  setupRole: null,
  setupTool: null,
  setupGoal: null,
  setupCompleted: false,
  setSetupRole: (role) => set((state) => ({
    setupRole: role,
    // Clear downstream selections when role changes — tools differ per role
    ...(state.setupRole !== role ? { setupTool: null, setupGoal: null } : {}),
  })),
  setSetupTool: (tool) => set({ setupTool: tool }),
  setSetupGoal: (goal) => set({ setupGoal: goal }),
  dismissSetup: () => set({ setupCompleted: true }),
});
