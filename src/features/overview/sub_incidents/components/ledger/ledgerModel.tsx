// Shared model for the two incident-ledger variants: one grid template (so a
// variant's header and its rows can never drift), the sortable column set, and
// the sort-header cell both variants render.
//
// Prototype-local copy (COPY) per the /prototype convention — extracted to
// i18n at consolidation.

import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import type { IncidentSortKey, SortDirection } from '../../libs/useIncidentLedger';

/** Line 2's columns. Line 1 (the title) spans the full row above them. */
export const LEDGER_GRID = 'minmax(96px, 0.7fr) minmax(120px, 1fr) minmax(120px, 1.1fr) 120px 72px minmax(116px, auto)';

export const LEDGER_COLUMNS: { key: IncidentSortKey | 'actions'; label: string; align?: 'right' }[] = [
  { key: 'severity', label: 'Severity' },
  { key: 'source', label: 'Source' },
  { key: 'persona', label: 'Agent' },
  { key: 'state', label: 'State' },
  { key: 'age', label: 'Age', align: 'right' },
  { key: 'actions', label: 'Actions', align: 'right' },
];

export const LEDGER_COPY = {
  titleColumn: 'Incident',
  empty: 'Nothing to show in this view.',
  new: 'New',
};

export interface IncidentLedgerViewProps {
  incidents: AuditIncident[];
  /** Keyboard-triage cursor, owned by the inbox shell. */
  focusedId: string | null;
  /** Incidents newer than this read as "new since your last visit". */
  lastSeenAt: string | null;
  onOpenDetail: (incident: AuditIncident) => void;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
  onReopen: (id: string) => void;
  /** Report the rows currently on screen so keyboard triage walks exactly them. */
  onPageRowsChange: (rows: AuditIncident[]) => void;
}

/** True when the incident arrived after the user last marked the inbox seen. */
export function isNewSince(incident: AuditIncident, lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  const cutoff = Date.parse(lastSeenAt);
  return !Number.isNaN(cutoff) && Date.parse(incident.createdAt) > cutoff;
}

/**
 * One column header. Sortable columns are buttons carrying the active
 * direction arrow; `actions` is a plain label (nothing to order by).
 */
export function LedgerSortHeader({
  column, sortKey, sortDir, onToggle, dense,
}: {
  column: (typeof LEDGER_COLUMNS)[number];
  sortKey: IncidentSortKey;
  sortDir: SortDirection;
  onToggle: (key: IncidentSortKey) => void;
  dense?: boolean;
}) {
  const active = column.key === sortKey;
  const justify = column.align === 'right' ? 'justify-end' : 'justify-start';
  const labelCls = dense
    ? 'typo-caption font-mono uppercase tracking-widest'
    : 'typo-caption uppercase tracking-wider font-semibold';

  if (column.key === 'actions') {
    return (
      <span className={`flex items-center ${justify} ${labelCls} text-foreground`}>{column.label}</span>
    );
  }

  const Arrow = sortDir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(column.key as IncidentSortKey)}
      aria-label={column.label}
      className={`flex items-center gap-1 ${justify} ${labelCls} rounded-interactive transition-colors focus-ring ${
        active ? 'text-primary' : 'text-foreground hover:text-primary/80'
      }`}
    >
      {column.label}
      <Arrow className={`h-3 w-3 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
    </button>
  );
}
