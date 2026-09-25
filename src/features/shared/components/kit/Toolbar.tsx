import type { ReactNode, Ref } from 'react';
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
 * @catalog KitButton - the kit 32px button over the shared Button (real busy spinner). Kit.
 */
export function KitButton({ children, onClick, loading, quiet, hint, className, testId }: {
  children: ReactNode;
  onClick: () => void;
  loading?: boolean;
  quiet?: boolean;
  /** A key glyph shown after the label (`Esc`, `↵`). */
  hint?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid={testId}
      className={cx('k-btn typo-label k-regular', quiet && 'k-btn--quiet', className)}
      loading={loading}
      onClick={onClick}
    >
      {children}
      {hint && <span className="k-kbd typo-code">{hint}</span>}
    </Button>
  );
}
