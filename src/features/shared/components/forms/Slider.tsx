import { useCallback, useEffect, useRef, useState } from 'react';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Accessible name for the slider. Strongly recommended. */
  ariaLabel?: string;
  /** Formats the value shown in the live bubble (defaults to the raw number). */
  formatValue?: (value: number) => string;
  /** Show the live value bubble while dragging / focused. Defaults to true. */
  showBubble?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Bounded-range slider built on a native `<input type="range">` (keyboard arrows,
 * Home/End, and a11y come for free; track fill is the global `--slider-progress`
 * CSS in globals.css). Adds a live value bubble that appears while dragging or
 * focused, positioned over the thumb. For values constrained to a range
 * (thresholds, temperature) where the magnitude matters as much as the number.
 */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  ariaLabel,
  formatValue,
  showBubble = true,
  disabled = false,
  id,
  className = '',
}: SliderProps) {
  const [active, setActive] = useState(false);
  const fraction = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

  // A pointer-drag ends with a window-level pointerup (the pointer may leave the thumb).
  const onPointerDown = useCallback(() => setActive(true), []);
  useEffect(() => {
    if (!active) return;
    const end = () => setActive(false);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [active]);

  const bubbleRef = useRef<HTMLDivElement>(null);
  const label = formatValue ? formatValue(value) : String(value);
  const showing = showBubble && active && !disabled;

  return (
    <div className={'relative w-full ' + className}>
      {showing && (
        <div
          ref={bubbleRef}
          aria-hidden
          className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded-card border border-primary/15 bg-background px-1.5 py-0.5 typo-caption font-medium text-foreground tabular-nums shadow-elevation-2"
          style={{ left: `calc(${fraction} * (100% - 14px) + 7px)` }}
        >
          {label}
        </div>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={onPointerDown}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        className="w-full"
        style={{ ['--slider-progress' as string]: fraction }}
      />
    </div>
  );
}

export default Slider;
