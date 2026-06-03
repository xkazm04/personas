import { useEffect, useState } from 'react';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

interface RegressionDeltaCounterProps {
  /** The signed delta to display (e.g. +4, 0, -7). */
  value: number;
  /** Pass-through className for the underlying counter span. */
  className?: string;
}

/**
 * A signed score delta that counts up from 0 to `value` on reveal (~500ms via
 * the shared rAF spring), so a regression result reads as the system *presenting*
 * its judgment rather than dumping a static number.
 *
 * Reuses {@link AnimatedCounter}, which initializes at its mounted value with no
 * animation; we mount at 0 and retarget to the real value on the next frame to
 * get the count-up. The sign prefix tracks the *target* (not the interpolated
 * value), so a negative delta counts `0 → -7` without a spurious `+0` flash.
 *
 * Respects `prefers-reduced-motion`: when set, the final value renders
 * immediately with no count animation.
 */
export function RegressionDeltaCounter({ value, className }: RegressionDeltaCounterProps) {
  const reducedMotion = useReducedMotion();
  const [target, setTarget] = useState(reducedMotion ? value : 0);

  useEffect(() => {
    if (reducedMotion) {
      setTarget(value);
      return;
    }
    const id = requestAnimationFrame(() => setTarget(value));
    return () => cancelAnimationFrame(id);
  }, [value, reducedMotion]);

  const sign = value >= 0 ? '+' : '';
  return (
    <AnimatedCounter
      value={target}
      className={className}
      formatFn={(v) => `${sign}${Math.round(v)}`}
    />
  );
}
