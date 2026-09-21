// The desk's bubble slots, lifted out of the cards.
//
// The baseline keeps one `useCardBubble` per card. The v2 desk needs the
// bubble at DESK level too — `r` replies to it and `y` / `n` settle the review
// it carries, from the keyboard, without the card having to expose its state —
// so the same rules run here once for the whole grid:
//
//   - ONE bubble per note; a newer entry replaces the one showing, EXCEPT that a
//     system milestone never buries a review still waiting on the operator.
//   - An entry that landed while its thread was on screen (`viewed`) is read
//     already and never bubbles.
//   - Only a note whose card is on screen bubbles here (`isNoteCardVisible`):
//     everything else was routed to the app-wide stack by the thread store, and
//     showing it twice would be two notifications for one entry.
//
// The 10 s clock itself stays inside the baseline `NoteCardBubble`, which calls
// back into `dismiss` when it runs out.
import { useCallback, useEffect, useState } from 'react';

import type { NoteComment } from '@/lib/bindings/NoteComment';

import { isNoteCardVisible } from '../../../thread/cardVisibility';
import { onNoteComment } from '../../../thread/noteThreadStore';
import { isPendingReview } from '../../../thread/threadLabels';

export function useDeskBubbles(): {
  bubbles: Readonly<Record<string, NoteComment>>;
  dismiss: (noteId: string) => void;
} {
  const [bubbles, setBubbles] = useState<Readonly<Record<string, NoteComment>>>({});

  useEffect(
    () =>
      onNoteComment(({ comment, viewed }) => {
        if (viewed || !isNoteCardVisible(comment.noteId)) return;
        setBubbles((prev) => {
          const showing = prev[comment.noteId];
          if (showing && comment.kind === 'system' && isPendingReview(showing)) return prev;
          return { ...prev, [comment.noteId]: comment };
        });
      }),
    [],
  );

  const dismiss = useCallback((noteId: string) => {
    setBubbles((prev) => {
      if (!(noteId in prev)) return prev;
      const next = { ...prev };
      delete next[noteId];
      return next;
    });
  }, []);

  return { bubbles, dismiss };
}
