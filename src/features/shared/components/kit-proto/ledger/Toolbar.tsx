/**
 * Toolbar row (Ledger kit): order is filter, pick, search, spacer, note. Owns the
 * control heights (2.3rem), the `/` focus key hint and the segmented pressed style.
 * The search filters as you type; the page owns the `/` binding (it registers on
 * the app's keyboard ladder) and focuses the field through the forwarded ref.
 */
import { forwardRef, type ReactNode } from 'react';
import type { LedgerTone } from './grid';

export function Toolbar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="tb" role="toolbar" data-role="lg-toolbar">
      {children}
      <span className="tb-spacer" />
      {note != null && <span className="tb-note typo-caption">{note}</span>}
    </div>
  );
}

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
  count?: ReactNode;
  swatch?: LedgerTone;
  hollow?: boolean;
}

export function Segmented<V extends string>({ label, value, options, onChange }: {
  label: string;
  value: V;
  options: SegmentOption<V>[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="typo-label"
          aria-pressed={o.value === value}
          data-role={o.value === value ? 'lg-seg-on' : 'lg-seg'}
          onClick={() => onChange(o.value)}
        >
          {o.swatch && <span className={`sw u-${o.swatch}${o.hollow ? ' u-hollow' : ''}`} aria-hidden="true" />}
          {o.label}
          {o.count != null && <span className="n typo-data k-regular">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const SearchField = forwardRef<HTMLInputElement, {
  value: string;
  placeholder: string;
  onChange: (q: string) => void;
  /** Escape clears focus; ArrowDown hands the keyboard to the list. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  'data-testid'?: string;
}>(function SearchField({ value, placeholder, onChange, onKeyDown, 'data-testid': testId }, ref) {
  return (
    <label className="field" data-role="lg-field">
      <span className="glass" aria-hidden="true" />
      <input
        ref={ref}
        className="typo-body"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="kbd typo-code" aria-hidden="true">/</span>
    </label>
  );
});
