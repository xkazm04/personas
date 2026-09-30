import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx, kitAttrs } from './types';

export interface RangePreset<V extends string | number> {
  v: V;
  label: ReactNode;
}

/**
 * RangePicker: a time window as preset segments (24h, 7d, 30d, ...) plus an optional Custom
 * segment that opens the caller's own date picking under it (the kit adds no calendar). A
 * picked custom range lights Custom and dims the presets; Esc or a press outside closes it.
 * @catalog RangePicker - a time-window control: preset segments plus an optional Custom segment that opens the caller's date picking. Kit.
 */
export function RangePicker<V extends string | number>({ label, presets, value, onChange, custom }: {
  label: string;
  presets: ReadonlyArray<RangePreset<V>>;
  /** The active preset; ignored while `custom.active`. */
  value: V;
  onChange: (v: V) => void;
  custom?: {
    label: ReactNode;
    /** A custom range is applied (Custom reads pressed). */
    active: boolean;
    /** The date picking, rendered under the control while open; `close` dismisses it. */
    render: (close: () => void) => ReactNode;
  };
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const customActive = !!custom?.active;
  return (
    <div ref={root} className="k-range" {...kitAttrs('RangePicker', open ? 'selected' : undefined)}>
      <div className="k-seg" role="group" aria-label={label}>
        {presets.map((p) => (
          <button
            key={String(p.v)}
            type="button"
            className="k-seg__opt typo-label k-regular"
            aria-pressed={!customActive && p.v === value}
            onClick={() => { onChange(p.v); setOpen(false); }}
          >
            {p.label}
          </button>
        ))}
        {custom && (
          <button
            type="button"
            className={cx('k-seg__opt typo-label k-regular', open && 'is-open')}
            aria-pressed={customActive}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="k-range__cal" aria-hidden="true" />
            {custom.label}
          </button>
        )}
      </div>
      {custom && open && custom.render(close)}
    </div>
  );
}
