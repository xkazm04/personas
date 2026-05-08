import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  registerAnimation,
  setAnimationTarget,
  unregisterAnimation,
} from '@/lib/utils/rafAnimationEngine';

interface AnimatedCounterProps {
  /** Target numeric value */
  value: number;
  /** Optional formatter (e.g. for currency, percentage) */
  formatFn?: (v: number) => string;
  /** Pass-through className for the wrapping span */
  className?: string;
}

const defaultFormat = (v: number) => String(Math.round(v));

const FADE_SECONDS = 0.15;

/**
 * Animates a numeric value with a per-digit slot-machine cross-fade.
 *
 * Spring physics come from the shared rAF engine; React only re-renders when the
 * formatted string actually changes (≈ once per integer crossing), so reconciliation
 * cost stays proportional to the visible delta. Each character is rendered as a
 * motion.span keyed by `position-char`, so AnimatePresence(popLayout) flips digits
 * in place. The wrapper is `inline-flex overflow-hidden` so the layout animation
 * at digit-count boundaries (9→10, 99→100, …) absorbs the width change instead of
 * causing kerning jank in surrounding text.
 */
export function AnimatedCounter({
  value,
  formatFn = defaultFormat,
  className,
}: AnimatedCounterProps) {
  const formatRef = useRef(formatFn);
  formatRef.current = formatFn;

  const [text, setText] = useState(() => formatFn(value));
  const keyRef = useRef<symbol | null>(null);

  useEffect(() => {
    const key = registerAnimation(value, (v) => {
      const formatted = formatRef.current(v);
      setText((prev) => (prev === formatted ? prev : formatted));
    });
    keyRef.current = key;
    return () => {
      unregisterAnimation(key);
      keyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (keyRef.current) {
      setAnimationTarget(keyRef.current, value);
    }
  }, [value]);

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: 'tabular-nums',
        display: 'inline-flex',
        alignItems: 'baseline',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {Array.from(text).map((char, i) => (
          <motion.span
            key={`${i}-${char}`}
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: FADE_SECONDS, ease: 'easeOut' }}
            style={{ display: 'inline-block' }}
          >
            {char}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}
