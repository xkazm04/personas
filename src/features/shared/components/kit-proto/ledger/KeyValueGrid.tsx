/**
 * Key-value grid + chip row (Ledger kit).
 * KeyValueGrid: auto-fill columns, a hairline above each pair, `typo-label` key,
 * `typo-data` regular value; a null value renders `nullText` quiet, never 0.
 * Chip: a hairline pill, name | 1px divider | count, 2px of ink under it = share.
 */
import type { ReactNode } from 'react';
import { pct } from './grid';

export interface KeyValueItem {
  key: string;
  label: ReactNode;
  /** Plain value; null renders `nullText`. Ignored when `figure` is given. */
  value?: ReactNode | null;
  /** A drawn value (a `<Figure>`). */
  figure?: ReactNode;
  warn?: boolean;
}

export function KeyValueGrid({ items, nullText }: { items: KeyValueItem[]; nullText: ReactNode }) {
  return (
    <dl className="kv">
      {items.map((it) => (
        <div key={it.key} className="kv-item" data-role="lg-kv">
          <dt className="kv-k typo-label" data-role="lg-kv-key">{it.label}</dt>
          <dd>
            {it.figure ?? (it.value == null
              ? <span className="kv-v typo-data k-regular is-null">{nullText}</span>
              : <span className={`kv-v typo-data k-regular${it.warn ? ' k-warn' : ''}`} data-role="lg-kv-value">{it.value}</span>)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface ChipItem {
  name: string;
  count?: ReactNode;
  /** Share of the row maximum, 0..1. */
  share?: number;
}

export function ChipRow({ chips }: { chips: ChipItem[] }) {
  return (
    <div className="chips">
      {chips.map((c) => (
        <span key={c.name} className="chip" data-role="lg-chip">
          <span className="typo-caption">{c.name}</span>
          {c.count != null && (
            <>
              <span className="chip-sep" aria-hidden="true" />
              <span className="chip-n typo-data k-regular">{c.count}</span>
            </>
          )}
          {c.share != null && <span className="chip-u" aria-hidden="true"><i style={{ width: pct(c.share) }} /></span>}
        </span>
      ))}
    </div>
  );
}
