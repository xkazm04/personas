/**
 * AthenaChatLiveRegion — a11y announcement of the latest completed reply.
 *
 * The chat bubbles are not inside a live region, so a screen reader would
 * never hear an assistant reply land. This mirrors the newest *completed*
 * assistant turn into a visually-hidden polite region; it updates (and is
 * announced) once streaming finishes and the full reply is in `messages`.
 *
 * Its own component so the scan for the last assistant message re-runs on
 * transcript changes only, not on every render of the chat body.
 */

import { useMemo } from 'react';
import { useCompanionStore } from '../companionStore';

export function AthenaChatLiveRegion() {
  const messages = useCompanionStore((s) => s.messages);
  const streaming = useCompanionStore((s) => s.streaming);

  const latest = useMemo(() => {
    if (streaming) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') return messages[i]?.content ?? '';
    }
    return '';
  }, [messages, streaming]);

  return (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {latest}
    </span>
  );
}
