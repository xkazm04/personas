import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import type { NotePatch, NoteSaveState } from '../notepadStore';

/** What a capture seeds a new note with. */
export interface NoteSeed {
  bodyMd?: string;
  projectId?: string | null;
}

/**
 * The IDENTICAL prop set every overview variant takes — same doctrine as
 * `NoteBodyProps`: the host owns the state, the variants own only layout, so
 * the winner is already the shape it ships as.
 */
export interface NoteOverviewProps {
  /** Open (non-archived) notes, in tab order. */
  notes: DevNote[];
  projects: readonly DevProject[];
  saveStates: Readonly<Record<string, NoteSaveState>>;
  atCap: boolean;
  /** A note just created from the overview, whose card should take the caret. */
  focusNoteId: string | null;
  /** Seeds the PROJECT filter once, on first render. The deep-link door: an
   *  outside surface ("show me this repo's notes") opens the pad already
   *  narrowed. Deliberately a seed and not a controlled value — once the pad is
   *  open the operator owns the filter, and a prop that kept re-asserting itself
   *  would fight every click. */
  initialProjectId?: string | null;
  /** Layer 2: raise the full editor on this note. */
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: NotePatch) => void;
  onCreate: (seed?: NoteSeed) => void;
}
