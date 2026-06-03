import { useCallback, useEffect, useRef, useState } from 'react';

export interface SliderProps {
  value: number;
  /** Fires continuously while dragging / on every keyboard step (the live "draft"). */
  onChange: (value: number) => void;
  /**
   * Fires once when an interaction settles (drag release or blur), and only when
   * the value actually changed. Use this — not `onChange` — for expensive side
   * effects (IPC, network) so a drag doesn't fire one per tick.
   */
  onCommit?: (value: number) => void;
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
  onCommit,
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

  // Refs let the window-level pointerup handler (registered once per active session)
  // read the latest value / onCommit without re-subscribing or capturing stale closures.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  // Value captured when the interaction began, so onCommit fires only on a real change.
  const startRef = useRef(value);

  const beginActive = useCallback(() => {
    startRef.current = valueRef.current;
    setActive(true);
  }, []);
  const endActive = useCallback(() => {
    setActive(false);
    if (onCommitRef.current && valueRef.current !== startRef.current) {
      onCommitRef.current(valueRef.current);
    }
    // Mark committed so a trailing blur after a drag-release doesn't double-fire.
    startRef.current = valueRef.current;
  }, []);

  // A pointer-drag ends with a window-level pointerup (the pointer may leave the thumb).
  useEffect(() => {
    if (!active) return;
    window.addEventListener('pointerup', endActive);
    window.addEventListener('pointercancel', endActive);
    return () => {
      window.removeEventListener('pointerup', endActive);
      window.removeEventListener('pointercancel', endActive);
    };
  }, [active, endActive]);

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
        onPointerDown={beginActive}
        onFocus={beginActive}
        onBlur={endActive}
        className="w-full"
        style={{ ['--slider-progress' as string]: fraction }}
      />
    </div>
  );
}

export default Slider;
