import { useEffect, useRef, useState } from 'react';
import {
  registerAnimation,
  setAnimationTarget,
  unregisterAnimation,
} from '@/lib/utils/rafAnimationEngine';

/**
 * Animates a number from its previous value to the target using a shared rAF spring loop.
 * Returns the current interpolated value with a smooth ease-out feel (~600ms settling).
 *
 * Note: This hook still uses setState for the return value since the caller needs
 * the numeric value in render. For DOM-only updates prefer AnimatedCounter directly.
 * The benefit here is sharing one rAF loop instead of N independent spring subscriptions.
 */
export function useAnimatedNumber(target: number): number {
  const [display, setDisplay] = useState(target);
  const keyRef = useRef<symbol | null>(null);

  useEffect(() => {
    const key = registerAnimation(target, (v) => setDisplay(v));
    keyRef.current = key;
    return () => {
      unregisterAnimation(key);
      keyRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (keyRef.current) {
      setAnimationTarget(keyRef.current, target);
    }
  }, [target]);

  return display;
}
