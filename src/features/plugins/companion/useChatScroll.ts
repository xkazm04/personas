import { useCallback, useEffect, useRef, useState } from 'react';

/** Treat the viewport as "pinned to bottom" within this many px of the end. */
const NEAR_BOTTOM_PX = 80;

/**
 * Bottom-aware autoscroll for a chat transcript.
 *
 * The companion panel used to force `scrollTop = scrollHeight` on every new
 * message, which yanked the user back down the moment they scrolled up to read
 * history. This hook keeps the transcript pinned to the bottom *only while the
 * user is already there*; once they scroll up, new content stays put and the
 * caller can surface a "jump to latest" affordance off `atBottom`.
 *
 * Usage:
 *   const { scrollRef, atBottom, scrollToBottom, maybeAutoScroll } = useChatScroll();
 *   useEffect(maybeAutoScroll, [messages, streamingText, streaming, maybeAutoScroll]);
 *   <div ref={scrollRef} className="overflow-y-auto">…</div>
 *   {!atBottom && <button onClick={() => scrollToBottom()}>↓</button>}
 */
export function useChatScroll() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Mirror of `atBottom` so `maybeAutoScroll` can stay a stable callback the
  // caller can list in an effect's deps without re-subscribing every render.
  const atBottomRef = useRef(true);

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom <= NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', recompute, { passive: true });
    return () => el.removeEventListener('scroll', recompute);
  }, [recompute]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  // Pin to bottom on new content, but only if the user hasn't scrolled away.
  const maybeAutoScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, []);

  return { scrollRef, atBottom, scrollToBottom, maybeAutoScroll };
}
