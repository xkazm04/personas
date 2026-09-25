/**
 * The ledger grid (Gate K prototype, kit A/1 "Ledger"): ONE set of tracks every
 * row snaps to, defined once as tokens in `kit.css` (`--lg-mark`, `--lg-pri-min`,
 * `--lg-meta`, `--lg-fig`, `--lg-time`, `--lg-act`). A block declares a spec and
 * `ledgerCols` turns it into `grid-template-columns`, so the list row, the column
 * head and the ghost rows of one block share their verticals.
 */
import type { CSSProperties } from 'react';

export type LedgerTone = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface LedgerSpec {
  meta?: boolean;
  figs?: number;
  time?: boolean;
  act?: boolean;
}

export function ledgerCols(spec: LedgerSpec): string {
  const t = ['var(--lg-mark)', 'minmax(var(--lg-pri-min), 1.6fr)'];
  if (spec.meta) t.push('var(--lg-meta)');
  for (let i = 0; i < (spec.figs ?? 0); i++) t.push('var(--lg-fig)');
  if (spec.time) t.push('var(--lg-time)');
  if (spec.act) t.push('var(--lg-act)');
  return t.join(' ');
}

/** The custom property the rows read their template from. */
export function ledgerColsStyle(spec: LedgerSpec): CSSProperties {
  return { '--lg-cols': ledgerCols(spec) } as CSSProperties;
}

/** A share of the column maximum, clamped, as a CSS width. */
export function pct(v: number): string {
  const c = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  return `${(c * 100).toFixed(1)}%`;
}
