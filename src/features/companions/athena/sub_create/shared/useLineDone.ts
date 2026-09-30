import { useEffect, useState } from 'react';

/**
 * `true` once the current line is fully visible. `TypedLine.onDone` is the
 * real signal; the timer is a belt-and-braces reveal for a line that never
 * reports (the WP0 stub) so a card can never be stranded behind a caption.
 * Shared by the Stage and Table shells.
 */
export const TYPING_CHARS_PER_S = 28;
const REVEAL_FALLBACK_CAP_MS = 8_000;

export function useLineDone(lineId: string, text: string): [boolean, () => void] {
  const [doneFor, setDoneFor] = useState<string | null>(null);
  useEffect(() => {
    const ms = Math.min(REVEAL_FALLBACK_CAP_MS, (text.length / TYPING_CHARS_PER_S) * 1000 + 500);
    const timer = setTimeout(() => setDoneFor(lineId), ms);
    return () => clearTimeout(timer);
  }, [lineId, text]);
  return [doneFor === lineId, () => setDoneFor(lineId)];
}
