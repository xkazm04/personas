import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import type { NotePatch } from '../notepadStore';
import type { NoteActions } from '../notepadActions';

/**
 * One Athena suggestion attached to a note. Shape mirrors the card config in
 * `.claude/spark/notepad-contract.md` § Athena. WP3 fills the array; until
 * then every variant receives `[]` and renders its `SuggestionSlot` empty —
 * which is the point of shipping the slot now rather than a `TODO`.
 */
export interface NoteSuggestion {
  rowId: string;
  kind: 'section' | 'edit' | 'question';
  anchor: { after_heading: string } | null;
  title?: string;
  bodyMd: string;
  outcome: null | 'accepted' | 'rejected' | 'edited';
}

/**
 * The IDENTICAL prop set every body variant takes.
 *
 * Identical is the whole design: the host switches between three directional
 * layouts without any of them owning state, fetching anything, or knowing
 * which one is on screen. When one wins, the other two are deleted and the
 * winner's file is already the shape it should have shipped as.
 */
export interface NoteBodyProps {
  note: DevNote;
  /** The single mutation door, pre-bound to this note by the host. */
  onPatch: (patch: NotePatch) => void;
  /** Body/project edits are legal only on a draft; the host computes this. */
  readOnly: boolean;
  project: DevProject | null;
  /** WP3 fills this. Empty today, and every variant renders that honestly. */
  suggestions: NoteSuggestion[];
  actions: NoteActions;
}
