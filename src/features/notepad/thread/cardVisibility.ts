// "Is this note's card on screen right now?" — the one question that routes a
// new thread entry to a CARD BUBBLE or to the app-wide LiveCommsStack.
//
// The visibility test is MOUNTING, deliberately: a desk card is mounted only
// while the pad is open, the overview (not the editor) is showing, and the card
// passes both desk filters. Each of those three conditions unmounts the card
// already, so a refcount of mounted cards answers all three without this module
// having to know about any of them. A refcount rather than a Set because React
// may mount a card's replacement before it unmounts the old one (StrictMode's
// double effect, an `AnimatePresence` exit that overlaps the re-entry).

const mounted = new Map<string, number>();

/** Called by a desk card's mount effect; returns the unmount half. */
export function registerVisibleCard(noteId: string): () => void {
  mounted.set(noteId, (mounted.get(noteId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (mounted.get(noteId) ?? 1) - 1;
    if (next <= 0) mounted.delete(noteId);
    else mounted.set(noteId, next);
  };
}

/** True while a desk card for the note is mounted (pad open · overview · passes the filters). */
export function isNoteCardVisible(noteId: string): boolean {
  return (mounted.get(noteId) ?? 0) > 0;
}

export function __resetCardVisibilityForTests(): void {
  mounted.clear();
}
