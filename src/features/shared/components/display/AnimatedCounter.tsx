import { useEffect, useRef, useState } from 'react';

interface AnimatedCounterProps {
  /** Target numeric value */
  value: number;
  /** Animation duration in ms (default 800) */
  duration?: number;
  /** Optional formatter (e.g. for currency, percentage) */
  formatFn?: (v: number) => string;
  /** Pass-through className for the wrapping span */
  className?: string;
}

/** easeOutExpo: fast start, decelerating finish */
function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

const defaultFormat = (v: number) => String(Math.round(v));

/**
 * Smoothly animates a numeric value using requestAnimationFrame.
 * On mount or when `value` changes, interpolates from the previous
 * displayed value to the new target with an exponential-ease-out curve.
 */
export function AnimatedCounter({
  value,
  duration = 800,
  formatFn = defaultFormat,
  className,
}: AnimatedCounterProps) {
  const [display, setDisplay] = useState(() => formatFn(value));
  const fromRef = useRef(0);
  const rafRef = useRef(0);
  const formatRef = useRef(formatFn);
  formatRef.current = formatFn;

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(formatRef.current(to));
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const current = from + (to - from) * easeOutExpo(t);
      setDisplay(formatRef.current(current));

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <span className={className}>{display}</span>;
}
