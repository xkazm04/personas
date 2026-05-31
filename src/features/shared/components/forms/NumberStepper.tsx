import {
  useCallback, useEffect, useRef, useState, type ReactNode,
} from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface NumberStepperProps {
  /** Current value. `null` renders the placeholder (only meaningful with `allowEmpty`). */
  value: number | null;
  /** Fires live on every keystroke / step (the "draft"). */
  onChange: (value: number | null) => void;
  /**
   * Fires once when an interaction settles (blur, Enter, or button release), and
   * only when the value actually changed. Use this — not `onChange` — for expensive
   * side effects (IPC, network) so typing or holding a button doesn't fire one per tick.
   */
  onCommit?: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Step applied by the +/- buttons and arrow keys. Drives display precision. */
  step?: number;
  /** Permit clearing the field to `null`. Defaults to false (always coerces to a number). */
  allowEmpty?: boolean;
  /** Value to seed from when stepping out of an empty field. Defaults to `min ?? 0`. */
  defaultValue?: number;
  placeholder?: string;
  /** Leading adornment inside the field (e.g. a `$`). */
  prefix?: ReactNode;
  /** Trailing adornment inside the field (e.g. a unit). */
  suffix?: ReactNode;
  /** Accessible name for the value input. Strongly recommended. */
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Decimal places implied by a step (e.g. 0.01 → 2, 1 → 0). */
function stepDecimals(step: number): number {
  if (!Number.isFinite(step)) return 0;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Polished numeric input: 28×28 minus/plus buttons flanking a centered value,
 * with hold-to-repeat acceleration, clamping to min/max, and step-aware rounding.
 * Replaces bare `<input type="number">` whose native spinners are micro-targets.
 */
export function NumberStepper({
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  allowEmpty = false,
  defaultValue,
  placeholder,
  prefix,
  suffix,
  ariaLabel,
  disabled = false,
  id,
  className = '',
}: NumberStepperProps) {
  const { t } = useTranslation();
  const decimals = stepDecimals(step);

  const clamp = useCallback(
    (n: number) => {
      let v = n;
      if (min != null && v < min) v = min;
      if (max != null && v > max) v = max;
      // Round to the step's precision to avoid binary float drift (0.1+0.2…).
      return decimals > 0 ? Number(v.toFixed(decimals)) : Math.round(v);
    },
    [min, max, decimals],
  );

  // Editing buffer so the user can type intermediate text ("0.", "") freely.
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value == null ? '' : String(value));
  }, [value, focused]);

  // Latest value read by the repeat loop without restarting it.
  const valueRef = useRef(value);
  valueRef.current = value;

  // onCommit fires only on a settle (blur / Enter / button release) and only when
  // the value changed since the interaction began — so an expensive onCommit (IPC)
  // isn't fired per keystroke or per held step. `onChange` remains the live draft.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const commitStartRef = useRef(value);
  const beginInteraction = useCallback(() => {
    commitStartRef.current = valueRef.current;
  }, []);
  const fireCommit = useCallback((v: number | null) => {
    if (onCommitRef.current && v !== commitStartRef.current) onCommitRef.current(v);
    commitStartRef.current = v;
  }, []);

  const doStep = useCallback(
    (dir: 1 | -1) => {
      // Stepping out of an empty field lands on the seed value, not seed ± step.
      const next =
        valueRef.current == null
          ? clamp(defaultValue ?? min ?? 0)
          : clamp(valueRef.current + dir * step);
      if (next !== valueRef.current) {
        valueRef.current = next;
        onChange(next);
      }
    },
    [clamp, step, defaultValue, min, onChange],
  );

  // Hold-to-repeat with acceleration: one immediate step, then an accelerating loop.
  const repeatTimer = useRef<number | null>(null);
  const stopRepeat = useCallback(() => {
    if (repeatTimer.current != null) {
      window.clearTimeout(repeatTimer.current);
      repeatTimer.current = null;
    }
  }, []);
  const startRepeat = useCallback(
    (dir: 1 | -1) => {
      doStep(dir);
      let delay = 350;
      const tick = () => {
        doStep(dir);
        delay = Math.max(40, delay * 0.82);
        repeatTimer.current = window.setTimeout(tick, delay);
      };
      repeatTimer.current = window.setTimeout(tick, delay);
    },
    [doStep],
  );
  useEffect(() => stopRepeat, [stopRepeat]);

  // Releasing (or leaving) a held button ends the step interaction and settles onCommit.
  const endStep = useCallback(() => {
    stopRepeat();
    fireCommit(valueRef.current);
  }, [stopRepeat, fireCommit]);

  const commitDraft = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        const next = allowEmpty ? null : clamp(defaultValue ?? min ?? 0);
        onChange(next);
        fireCommit(next);
        return;
      }
      const n = Number(trimmed);
      if (Number.isNaN(n)) {
        // Revert the buffer to the last committed value.
        setDraft(value == null ? '' : String(value));
        return;
      }
      const next = clamp(n);
      onChange(next);
      fireCommit(next);
    },
    [allowEmpty, clamp, defaultValue, min, onChange, value, fireCommit],
  );

  const atMin = min != null && value != null && value <= min;
  const atMax = max != null && value != null && value >= max;

  const btnBase =
    'flex items-center justify-center w-7 h-7 shrink-0 text-foreground ' +
    'transition-colors focus-ring disabled:opacity-30 disabled:cursor-not-allowed ' +
    'hover:bg-secondary/50 active:bg-secondary/70';

  return (
    <div
      className={
        'inline-flex items-stretch rounded-input border border-primary/12 ' +
        'bg-background/50 overflow-hidden focus-within:ring-2 focus-within:ring-accent/60 ' +
        (disabled ? 'opacity-50 ' : '') +
        className
      }
    >
      <button
        type="button"
        aria-label={t.common.decrease}
        disabled={disabled || atMin}
        onPointerDown={(e) => {
          e.preventDefault();
          if (!disabled) {
            beginInteraction();
            startRepeat(-1);
          }
        }}
        onPointerUp={endStep}
        onPointerLeave={endStep}
        onPointerCancel={stopRepeat}
        className={btnBase + ' border-r border-primary/12 rounded-none'}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-center justify-center min-w-0 flex-1 px-1">
        {prefix != null && (
          <span className="pl-1 typo-caption text-foreground select-none">{prefix}</span>
        )}
        <input
          id={id}
          type="text"
          inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          role="spinbutton"
          aria-label={ariaLabel}
          aria-valuenow={value ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          disabled={disabled}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const trimmed = raw.trim();
            if (trimmed === '') {
              if (allowEmpty) onChange(null);
              return;
            }
            const n = Number(trimmed);
            if (!Number.isNaN(n)) onChange(n);
          }}
          onFocus={() => {
            setFocused(true);
            beginInteraction();
          }}
          onBlur={(e) => {
            setFocused(false);
            commitDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              doStep(1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              doStep(-1);
            } else if (e.key === 'Enter') {
              commitDraft((e.target as HTMLInputElement).value);
            }
          }}
          className="w-full min-w-0 bg-transparent text-center typo-body text-foreground tabular-nums outline-none placeholder:text-muted-foreground/40 px-1 py-1.5"
        />
        {suffix != null && (
          <span className="pr-1 typo-caption text-foreground select-none">{suffix}</span>
        )}
      </div>

      <button
        type="button"
        aria-label={t.common.increase}
        disabled={disabled || atMax}
        onPointerDown={(e) => {
          e.preventDefault();
          if (!disabled) {
            beginInteraction();
            startRepeat(1);
          }
        }}
        onPointerUp={endStep}
        onPointerLeave={endStep}
        onPointerCancel={stopRepeat}
        className={btnBase + ' border-l border-primary/12 rounded-none'}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default NumberStepper;
