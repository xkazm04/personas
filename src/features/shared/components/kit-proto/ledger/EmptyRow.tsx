/**
 * EmptyRow and GhostRows (Ledger kit). EmptyRow: a dashed mark, one strong line,
 * the reason, an optional action, on the same grid gutter as a row. GhostRows:
 * bars on the block's own tracks with a slow shimmer (none under reduced motion),
 * the loading state under permanent chrome (loading pattern v2).
 */
import type { ReactNode } from 'react';
import type { LedgerSpec } from './grid';

export function EmptyRow({ title, why, action, 'data-testid': testId }: {
  title: ReactNode;
  why?: ReactNode;
  action?: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div className="empty" role="status" data-testid={testId}>
      <span className="empty-mark" aria-hidden="true" />
      <span className="empty-text">
        <span className="empty-title typo-body k-strong">{title}</span>
        {why != null && <span className="empty-why typo-caption">{why}</span>}
      </span>
      {action != null && <span>{action}</span>}
    </div>
  );
}

const WIDTHS = [72, 58, 66, 50];

export function GhostRows({ spec, count, label }: { spec: LedgerSpec; count: number; label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, r) => {
        const w = WIDTHS[r % WIDTHS.length]!;
        return (
          <div key={r} className="lg-row" data-h="2" aria-hidden="true">
            <span />
            <span className="c-pri">
              <span className="ghost-bar" style={{ width: `${w}%` }} />
              <span className="ghost-bar is-sub" style={{ width: `${w - 24}%` }} />
            </span>
            {spec.meta && <span className="c-meta"><span className="ghost-bar" style={{ width: '70%' }} /></span>}
            {Array.from({ length: spec.figs ?? 0 }, (_, i) => (
              <span key={i} className="c-fig"><span className="ghost-bar is-fig" /></span>
            ))}
            {spec.time && <span className="c-time"><span className="ghost-bar is-fig" /></span>}
            {spec.act && <span />}
          </div>
        );
      })}
    </div>
  );
}
