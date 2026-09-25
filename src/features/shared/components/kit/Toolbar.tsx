import type { KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { Dot } from './Mark';
import { cx, kitAttrs, stateClass, type Glyph, type KitState, type Tone } from './types';

/** Toolbar: owns control heights (30/36px), spacing and wrap; the caller owns the filtering logic.
 * @catalog Toolbar - a surface filter bar (Segmented, SearchField, KitButton), 30/36px controls. Kit.
 */
export function Toolbar({ label, state, children }: { label: string; state?: KitState; children: ReactNode }) {
  return (
    <div className={cx('k-toolbar', stateClass(state))} {...kitAttrs('Toolbar', state)} role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

export interface SegmentOption<V extends string> {
  v: V;
  label: ReactNode;
  count?: ReactNode;
  tone?: Tone;
  glyph?: Glyph;
}

/** Segmented: a closed choice; each option can carry the glyph of the state it filters to.
 * @catalog Segmented - closed choice whose options can carry a state glyph and count. Kit.
 */
export function Segmented<V extends string>({ label, options, value, onChange }: {
  label: string;
  options: ReadonlyArray<SegmentOption<V>>;
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <div className="k-seg" role="group" aria-label={label}>
      {options.map((op) => (
        <button
          key={op.v}
          type="button"
          className="k-seg__opt typo-label k-regular"
          aria-pressed={op.v === value}
          onClick={() => onChange(op.v)}
        >
          {op.glyph && <Dot tone={op.tone} glyph={op.glyph} />}
          <span>{op.label}</span>
          {op.count != null && <span className="typo-data k-regular k-quiet">{op.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Search: a 36px field with the `/` hint; the hint is the key that focuses it.
 * @catalog SearchField - 36px search field with the / hint. Kit.
 */
export function SearchField({ value, onChange, placeholder, inputRef, testId }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  testId?: string;
}) {
  return (
    <label className="k-search">
      <span className="k-search__glyph" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="typo-body"
        data-testid={testId}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="k-kbd typo-code" aria-hidden="true">/</span>
    </label>
  );
}

/**
 * The kit's 32px button. It renders the shared Button, so a busy state is the product's real
 * spinner with disabled + aria-busy, and wears the kit's look (kit.css is unlayered).
 * `disabled` is the shared Button's: native disabled (out of the tab order, click inert, the
 * disabled token's muted look), with `disabledReason` on a focusable wrapper that says why.
 * `stopPropagation` is for an action inside a selectable row or card: its press (and the
 * Enter/Space that activates it) never reaches the row, and a promise from `onClick` still
 * reaches the Button's double-submit guard.
 * @catalog KitButton - the kit 32px button over the shared Button (real busy spinner; disabled with a reason; stopPropagation inside a selectable row). Kit.
 */
export function KitButton({ children, onClick, loading, quiet, hint, className, testId, pressed, expanded, disabled, disabledReason, stopPropagation, label }: {
  children: ReactNode;
  onClick: () => unknown;
  loading?: boolean;
  quiet?: boolean;
  /** A toggle: sets aria-pressed, which kit.css already draws as the pressed (selected) look. */
  pressed?: boolean;
  /** A disclosure: sets aria-expanded for the region it opens. */
  expanded?: boolean;
  /** A key glyph shown after the label (`Esc`, `↵`). */
  hint?: string;
  className?: string;
  testId?: string;
  disabled?: boolean;
  /** Why it is disabled; surfaces as the shared Tooltip on hover and keyboard focus. */
  disabledReason?: string;
  /** Keep the press inside this button (an action in a clickable row or card). */
  stopPropagation?: boolean;
  /** Accessible name when the content is not text (a sparkline and a figure). */
  label?: string;
}) {
  const stop = stopPropagation
    ? { onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); } }
    : null;
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid={testId}
      className={cx('k-btn typo-label k-regular', quiet && 'k-btn--quiet', className)}
      loading={loading}
      disabled={disabled}
      disabledReason={disabledReason}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      onClick={stopPropagation ? (e: MouseEvent) => { e.stopPropagation(); return onClick(); } : onClick}
      {...stop}
    >
      {children}
      {hint && <span className="k-kbd typo-code">{hint}</span>}
    </Button>
  );
}
