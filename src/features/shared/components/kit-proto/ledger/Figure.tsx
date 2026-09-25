/**
 * Figure, Units and SplitBar: the Ledger kit's ways to draw a quantity.
 * A figure is a number with 2px of ink under it for its share of the column
 * maximum (`of`); `split` draws a pale leading part first (cache read).
 */
import type { ReactNode } from 'react';
import { formatCompactNumber } from '@/lib/utils/formatters';
import { pct, type LedgerTone } from './grid';

export function Figure({ value, of, split, tone }: {
  value: ReactNode;
  /** Share of the column maximum, 0..1. Omitted: no ink track at all. */
  of?: number;
  /** Pale share of the ink, 0..1 (drawn first). */
  split?: number;
  tone?: LedgerTone;
}) {
  const ink = of == null ? null : (
    <span className={`ink${tone ? ` t-${tone}` : ''}${of === 0 ? ' is-zero' : ''}`}>
      {split != null ? (
        <>
          <i className="pale" style={{ width: pct(of * split) }} />
          <i style={{ width: pct(of * (1 - split)) }} />
        </>
      ) : (
        <i style={{ width: pct(of) }} />
      )}
    </span>
  );
  return (
    <span className="fig" data-role="lg-fig">
      <span className="fig-n typo-data k-regular">{value}</span>
      {ink}
    </span>
  );
}

/** One countable square per unit; a `hollow` unit is outlined (hibernated). */
export interface LedgerUnit { tone: LedgerTone; hollow?: boolean }

export function Units({ units, tall, label }: { units: LedgerUnit[]; tall?: boolean; label: string }) {
  return (
    <span className={`units${tall ? ' is-tall' : ''}`} role="img" aria-label={label}>
      {units.map((u, i) => <i key={i} className={`u-${u.tone}${u.hollow ? ' u-hollow' : ''}`} />)}
    </span>
  );
}

export interface SplitPart { value: number; tone?: LedgerTone; pale?: boolean }

export function SplitBar({ parts, label }: { parts: SplitPart[]; label: string }) {
  return (
    <span className="split-bar" role="img" aria-label={label}>
      {parts.map((p, i) => (
        <i key={i} className={[p.tone ? `t-${p.tone}` : '', p.pale ? 'is-pale' : ''].filter(Boolean).join(' ')} style={{ flex: p.value }} />
      ))}
    </span>
  );
}

/**
 * The kit's figure recipe for a large count: compact from 1,000, one decimal below
 * 10k and between 1M and 10M, none otherwise (8.1k, 743k, 3.6M, 12M), in the active
 * locale. `formatCompactNumber`'s defaults (full figures under 10k, one decimal
 * everywhere) print 742.8K and 8,100, which widen every figure column.
 */
export function ledgerCompact(v: number): string {
  const a = Math.abs(v);
  const precision = a < 1e4 || (a >= 1e6 && a < 1e7) ? 1 : 0;
  return formatCompactNumber(v, { precision, threshold: 1000 });
}
