/**
 * Stat strip + stat tile (Ledger kit): no box; tiles separated by vertical
 * hairlines, the first aligned to the primary track; `typo-label` label,
 * `typo-data-lg` figure, a drawing, a caption sub. In the compact tier a tile at
 * least 9.5rem wide sets figure | drawing-over-caption side by side.
 */
import type { ReactNode } from 'react';

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="strip" data-role="lg-strip">{children}</div>;
}

export function StatTile({ label, figure, draw, sub, loading }: {
  label: ReactNode;
  /** The figure as rendered (a `<Numeric>`); null reads as not measured. */
  figure: ReactNode;
  draw?: ReactNode;
  sub?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="tile" data-role="lg-tile">
      <span className="tile-in">
        <span className="tile-label typo-label" data-role="lg-tile-label">{label}</span>
        <span className="tile-fig">
          <span className="typo-data-lg" data-role="lg-tile-fig">
            {loading ? <span className="ghost-bar ghost-tile" /> : figure ?? '—'}
          </span>
        </span>
        <span className="tile-draw">{loading ? null : draw}</span>
        {sub != null && <span className="tile-sub typo-caption" data-role="lg-tile-sub">{loading ? null : sub}</span>}
      </span>
    </div>
  );
}
