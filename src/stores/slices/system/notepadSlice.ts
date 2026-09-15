import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';

/**
 * Chrome state for the Notepad overlay.
 *
 * Deliberately thin — the same shape as `fleetGridOpen` / `fleetActiveSessionId`
 * on the fleet slice. The NOTES themselves live in the notepad module store
 * (`src/features/notepad/notepadStore.ts`), which owns the shadow/debounce
 * machinery; putting note rows in a persisted zustand slice would mean two
 * copies of a durable document racing each other on rehydrate.
 *
 * Only `notepadActiveNoteId` is persisted: which tab you were on is a
 * preference worth restoring, whether the overlay was raised is not — an app
 * that reopens with a full-screen editor over the page you wanted is hostile.
 */
export interface NotepadSlice {
  /** True while the fullscreen notepad overlay is raised. In-memory. */
  notepadOpen: boolean;
  /** Last-focused note id. Persisted; may name a note that no longer exists,
   *  which the module store treats as "no selection" rather than an error. */
  notepadActiveNoteId: string | null;
  /**
   * A project the pad should open FOCUSED on — the deep link every retired
   * "open ship" door now lands on (the Mastermind island menu, the milestone
   * status bar, the passport cover's roadmap strip).
   *
   * In-memory and NEVER persisted, unlike `notepadActiveNoteId`: it is a single
   * navigation intent, not a preference. Persisting it would mean the next cold
   * launch opened the desk pre-filtered to whichever project the operator
   * happened to click a week ago, with nothing on screen saying why.
   *
   * CONSUMED ONCE. `NotepadOverlayHost` reads it on open, hands it to
   * `NoteOverview` as `initialProjectId`, and clears it — the same
   * consume-and-clear contract `pendingFactoryFocus` has in `uiSlice`, and for
   * the same reason: a pending value left set would re-seed the filter every
   * time the pad reopened.
   */
  notepadPendingProject: string | null;

  notepadSetOpen: (open: boolean) => void;
  notepadSetActiveNote: (id: string | null) => void;
  /** Raise the pad with the desk filtered to one project. The door itself —
   *  callers pass a `dev_projects.id` (the passport wall's `identity.slug` IS
   *  that id, see passportDerive.ts:305). */
  notepadOpenForProject: (projectId: string) => void;
  /** Clear the pending project after the host has consumed it. */
  notepadClearPendingProject: () => void;
}

export const createNotepadSlice: StateCreator<SystemStore, [], [], NotepadSlice> = (set) => ({
  notepadOpen: false,
  notepadActiveNoteId: null,
  notepadPendingProject: null,

  notepadSetOpen: (open) => set({ notepadOpen: open }),
  notepadSetActiveNote: (id) => set({ notepadActiveNoteId: id }),
  // Both fields in ONE set: the host consumes the pending project in the same
  // effect that sees `notepadOpen` flip, so a two-step write could paint the
  // desk unfiltered for a frame before the filter arrived.
  notepadOpenForProject: (projectId) =>
    set({ notepadPendingProject: projectId, notepadOpen: true }),
  notepadClearPendingProject: () => set({ notepadPendingProject: null }),
});
