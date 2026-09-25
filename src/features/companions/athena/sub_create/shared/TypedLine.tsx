/**
 * Athena's current line, typed in at ~28 chars/s on a rAF clock (precedent:
 * `useTypewriter` in `src/features/studio/StudioMessages.tsx`). Re-types when
 * `lineId` changes; click anywhere on it to reveal the rest at once; instant
 * under reduced motion. The full text always sits in `aria-label` so screen
 * readers get the sentence whole instead of a letter stream.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

const CHARS_PER_SEC = 28;

export interface TypedLineProps {
  lineId: string;
  text: string;
  /** Fires once when the full text is visible (typed out or skipped). */
  onDone?: () => void;
  className?: string;
}

export function TypedLine({ lineId, text, onDone, className }: TypedLineProps) {
  const { shouldAnimate } = useMotion();
  const [count, setCount] = useState(() => (shouldAnimate ? 0 : text.length));
  // Set by click-to-reveal so a frame already scheduled cannot roll the
  // count back below the full length.
  const skipRef = useRef(false);
  const doneForRef = useRef<string | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    skipRef.current = false;
    if (!shouldAnimate) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let raf = 0;
    // `null`, not `0`: a rAF timestamp can legitimately be 0.
    let start: number | null = null;
    const tick = (now: number) => {
      if (skipRef.current) return;
      if (start === null) start = now;
      const next = Math.min(text.length, Math.floor(((now - start) / 1000) * CHARS_PER_SEC));
      setCount(next);
      if (next < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lineId, text, shouldAnimate]);

  // `onDone` once per line id, whether it was typed out or skipped.
  useEffect(() => {
    if (count >= text.length && doneForRef.current !== lineId) {
      doneForRef.current = lineId;
      onDoneRef.current?.();
    }
  }, [count, text.length, lineId]);

  const revealAll = useCallback(() => {
    skipRef.current = true;
    setCount(text.length);
  }, [text.length]);

  const complete = count >= text.length;
  return (
    <p
      className={className}
      aria-label={text}
      data-testid="create-athena-typed-line"
      data-complete={complete ? 'true' : 'false'}
      onClick={complete ? undefined : revealAll}
    >
      <span aria-hidden="true">{text.slice(0, count)}</span>
    </p>
  );
}
