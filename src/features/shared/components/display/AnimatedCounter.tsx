import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  registerAnimation,
  setAnimationTarget,
  unregisterAnimation,
} from '@/lib/utils/rafAnimationEngine';

export type AnimatedCounterMode = 'fade' | 'roll';

interface AnimatedCounterProps {
  /** Target numeric value */
  value: number;
  /** Optional formatter (e.g. for currency, percentage) */
  formatFn?: (v: number) => string;
  /** Pass-through className for the wrapping span */
  className?: string;
  /**
   * `fade` (default) — per-digit cross-fade via popLayout. Cheap, works for
   * any text shape (formatters that emit currency, percentages, etc.).
   * `roll` — slot-machine column per digit position. Each digit slot is an
   * absolute-positioned column 0–9 whose translateY animates to the current
   * digit (280ms cubic-bezier). Reads as premium/intentional craft for
   * headline KPIs. Falls back to `fade` when prefers-reduced-motion is set.
   */
  mode?: AnimatedCounterMode;
}

const defaultFormat = (v: number) => String(Math.round(v));

const FADE_SECONDS = 0.15;
const ROLL_SECONDS = 0.28;
const ROLL_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * Animates a numeric value with a per-digit cross-fade or, opt-in via
 * `mode="roll"`, a slot-machine column roll for headline KPIs.
 *
 * Spring physics come from the shared rAF engine; React only re-renders when
 * the formatted string actually changes (≈ once per integer crossing), so
 * reconciliation cost stays proportional to the visible delta. Multiple
 * counters mounted at once stay in sync because they all subscribe to the
 * same engine tick.
 */
export function AnimatedCounter({
  value,
  formatFn = defaultFormat,
  className,
  mode = 'fade',
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

  const reducedMotion = useReducedMotion();
  const effectiveMode: AnimatedCounterMode = reducedMotion ? 'fade' : mode;

  if (effectiveMode === 'roll') {
    return <RollCounter text={text} className={className} />;
  }

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

/* RollCounter — slot-machine variant. Each digit position renders as a
 * fixed-height window with a 10-cell vertical column inside. Changing the
 * digit slides the column by translateY(-n * cellHeight). Non-digit chars
 * (',', '.', '$', '%') render statically — only digit positions roll.
 *
 * The cell-height is measured at mount from the first digit cell so the
 * roll distance matches the actual line-box height of the surrounding
 * typography. No layout re-measurement on text change — the column
 * animates within the measured window. */
function RollCounter({ text, className }: { text: string; className?: string }) {
  const positions = useMemo(() => Array.from(text), [text]);

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: 'tabular-nums',
        display: 'inline-flex',
        alignItems: 'baseline',
        whiteSpace: 'nowrap',
      }}
    >
      {positions.map((char, i) => {
        if (!/^[0-9]$/.test(char)) {
          // Static slot for separators and currency glyphs.
          return (
            <span key={`s-${i}-${char}`} style={{ display: 'inline-block' }}>
              {char}
            </span>
          );
        }
        return <RollSlot key={`r-${i}`} digit={Number(char)} />;
      })}
    </span>
  );
}

function RollSlot({ digit }: { digit: number }) {
  // Each cell is 1em tall — clipping window is one line of the surrounding
  // typography, so the slot keeps perfect baseline alignment with adjacent
  // static glyphs without any imperative measurement.
  return (
    <span
      style={{
        display: 'inline-block',
        height: '1em',
        lineHeight: 1,
        overflow: 'hidden',
        verticalAlign: 'baseline',
        position: 'relative',
        // Width = single-digit advance via tabular-nums + an em-based ch
        // approximation; tabular-nums on the parent guarantees uniform width.
      }}
      aria-hidden="true"
    >
      <motion.span
        animate={{ y: `-${digit}em` }}
        transition={{ duration: ROLL_SECONDS, ease: ROLL_EASE }}
        style={{ display: 'inline-flex', flexDirection: 'column' }}
      >
        {DIGITS.map((d) => (
          <span key={d} style={{ height: '1em', lineHeight: 1, display: 'block' }}>
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/* Minimal prefers-reduced-motion hook — avoids pulling in framer-motion's
 * useReducedMotion (which has additional behavior we don't need here). */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}
