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

  notepadSetOpen: (open: boolean) => void;
  notepadSetActiveNote: (id: string | null) => void;
}

export const createNotepadSlice: StateCreator<SystemStore, [], [], NotepadSlice> = (set) => ({
  notepadOpen: false,
  notepadActiveNoteId: null,

  notepadSetOpen: (open) => set({ notepadOpen: open }),
  notepadSetActiveNote: (id) => set({ notepadActiveNoteId: id }),
});
