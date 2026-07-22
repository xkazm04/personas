// Persisted canvas text notes (note tool). Prototype-stage persistence:
// localStorage, shared across canvas variants like positions/groups/links.
import type { CanvasNote, NoteSize } from './types';

const KEY = 'mastermind.notes.v1';

/** World-px font size per note size step. */
export const NOTE_SIZE_PX: Record<NoteSize, number> = { sm: 16, md: 26, lg: 42 };

export function loadNotes(): CanvasNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CanvasNote[]) : [];
  } catch {
    return [];
  }
}

export function saveNotes(notes: CanvasNote[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {
    // best-effort — a full/blocked storage never breaks the canvas
  }
}
