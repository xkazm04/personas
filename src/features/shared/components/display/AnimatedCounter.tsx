import { useEffect, useRef } from 'react';
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

/**
 * Smoothly animates a numeric value using a shared rAF spring loop.
 * Writes directly to the DOM via ref — no setState during animation.
 */
export function AnimatedCounter({
  value,
  formatFn = defaultFormat,
  className,
}: AnimatedCounterProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const formatRef = useRef(formatFn);
  formatRef.current = formatFn;
  const keyRef = useRef<symbol | null>(null);

  useEffect(() => {
    const key = registerAnimation(value, (v) => {
      if (spanRef.current) {
        spanRef.current.textContent = formatRef.current(v);
      }
    });
    keyRef.current = key;
    return () => {
      unregisterAnimation(key);
      keyRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (keyRef.current) {
      setAnimationTarget(keyRef.current, value);
    }
  }, [value]);

  return (
    <span
      ref={spanRef}
      className={className}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {formatFn(value)}
    </span>
  );
}
