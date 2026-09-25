/**
 * Folio (Ledger kit pattern): the selected row's detail as a second ledger column
 * right of the table, 18.5rem, sticky; under 62rem of container it floats over the
 * table as an elevated layer. `LedgerSplit` is the two-column frame it sits in:
 * with a folio open the table's figure tracks narrow and the name track never does.
 */
import type { ReactNode } from 'react';

export function LedgerSplit({ open, table, folio }: { open: boolean; table: ReactNode; folio: ReactNode }) {
  return (
    <div className="split-wrap">
      <div className={`split${open ? ' has-folio' : ''}`}>
        {table}
        {open ? folio : null}
      </div>
    </div>
  );
}

export function Folio({ label, eyebrow, title, state, close, actions, children, 'data-testid': testId }: {
  label: string;
  eyebrow: ReactNode;
  title: ReactNode;
  state?: ReactNode;
  /** The Close control (a shared `Button`); Esc is bound by the page. */
  close?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <aside className="folio" aria-label={label} data-role="lg-folio" data-testid={testId}>
      <div className="folio-head">
        <div className="folio-titles">
          <span className="folio-eyebrow typo-eyebrow">{eyebrow}</span>
          <span className="typo-title-lg" data-role="lg-folio-title">{title}</span>
          {state != null && <span className="folio-state typo-caption">{state}</span>}
        </div>
        {close}
      </div>
      {children}
      {actions != null && <div className="folio-actions">{actions}</div>}
    </aside>
  );
}

export function FolioPart({ title, count, children }: { title: ReactNode; count?: ReactNode; children?: ReactNode }) {
  return (
    <div className="folio-part">
      <div className="folio-part-head">
        <span className="typo-label" data-role="lg-folio-part">{title}</span>
        {count != null && <span className="n typo-data k-regular">{count}</span>}
      </div>
      {children}
    </div>
  );
}
