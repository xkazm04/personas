import { useEffect, useRef } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';

export interface CharBudgetProps {
  /** Current character count. */
  value: number;
  /** Maximum allowed characters. When <= 0, the meter renders nothing. */
  max: number;
  /**
   * When false (caller's input lost focus), the meter hides if usage is below
   * 50% — but stays visible if the user is still over budget. Defaults to true.
   */
  focused?: boolean;
  className?: string;
}

const SHOW_THRESHOLD = 0.7;
const AMBER_THRESHOLD = 0.9;
const HIDE_ON_BLUR_THRESHOLD = 0.5;

export function CharBudget({ value, max, focused = true, className }: CharBudgetProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const wasAtLimit = useRef(false);

  const ratio = max > 0 ? value / max : 0;
  const atLimit = max > 0 && value >= max;
  const amber = !atLimit && ratio >= AMBER_THRESHOLD;
  const visible = focused
    ? ratio >= SHOW_THRESHOLD || atLimit
    : ratio >= HIDE_ON_BLUR_THRESHOLD || atLimit;

  useEffect(() => {
    const justCrossed = atLimit && !wasAtLimit.current && ref.current;
    wasAtLimit.current = atLimit;
    if (!justCrossed) return;
    const el = ref.current!;
    el.classList.remove('animate-char-budget-shake');
    void el.offsetWidth;
    el.classList.add('animate-char-budget-shake');
    const onEnd = () => el.classList.remove('animate-char-budget-shake');
    el.addEventListener('animationend', onEnd, { once: true });
    return () => {
      el.removeEventListener('animationend', onEnd);
    };
  }, [atLimit]);

  if (max <= 0) return null;

  const stateClass = atLimit
    ? 'text-red-400 ring-1 ring-red-400/50 rounded-sm px-1'
    : amber
      ? 'text-amber-400/90'
      : 'text-foreground';

  return (
    <span
      ref={ref}
      aria-live="polite"
      aria-label={`${value} of ${max} characters used`}
      className={`typo-body tabular-nums select-none transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      } ${stateClass} ${className ?? ''}`}
    >
      <Numeric value={value} />/<Numeric value={max} />
    </span>
  );
}
