// Canvas text notes (note tool). Persistence now lives in the durable layout
// store (one versioned DB document); this module keeps the per-size font map
// and the stable load/save import surface for callers.
import type { NoteSize } from './types';

export { loadNotes, saveNotes } from './layoutStore';

/** World-px font size per note size step (xl = section headers). */
export const NOTE_SIZE_PX: Record<NoteSize, number> = { sm: 16, md: 26, lg: 42, xl: 64 };
