import { useEffect, useState } from 'react';
import { useSpring, useMotionValueEvent, useReducedMotion } from 'framer-motion';
import { Numeric } from '@/features/shared/components/display/Numeric';

/**
 * Spring physics shared with the cloud `ActivityGauge` so every cloud telemetry
 * number counts up with the same feel. Keep these in sync with
 * `CloudStatusPanel`'s gauge spring.
 */
const COUNT_UP_SPRING = { stiffness: 180, damping: 22, mass: 0.55 } as const;

export interface SpringCountProps {
  /** Target value. Changes animate via the shared count-up spring. */
  value: number;
  /** Formats the rounded display value. Defaults to grouped locale digits. */
  format?: (n: number) => string;
  className?: string;
}

/**
 * @catalog Count-up number animated with the shared cloud count-up spring (stiffness 180 / damping 22); wrap in <Numeric> for tabular figure styling. Respects prefers-reduced-motion.
 *
 * Initializes at `value` (no fly-up-from-zero on mount) and animates only when
 * the value changes — matching the cloud `ActivityGauge`. Under
 * prefers-reduced-motion it snaps to the target with no interpolation.
 */
export function SpringCount({ value, format, className }: SpringCountProps) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, COUNT_UP_SPRING);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (reduce) {
      spring.jump(value);
      setDisplay(value);
    } else {
      spring.set(value);
    }
  }, [value, reduce, spring]);

  useMotionValueEvent(spring, 'change', (v) => setDisplay(v));

  const shown = Math.round(reduce ? value : display);
  return (
    <span className={className}>
      {format ? format(shown) : <Numeric value={shown} />}
    </span>
  );
}
