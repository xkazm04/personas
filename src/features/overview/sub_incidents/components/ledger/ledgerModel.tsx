// Shared model for the incidents ledger: one grid template (so the column
// header and the rows below it can never drift), the sortable column set, and
// the sort-header cell.

import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Translations } from '@/i18n/generated/types';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import type { IncidentSortKey, SortDirection } from '../../libs/useIncidentLedger';

/** Line 2's columns. Line 1 (the title) spans the full row above them. */
export const LEDGER_GRID = 'minmax(96px, 0.7fr) minmax(120px, 1fr) minmax(120px, 1.1fr) 120px 72px minmax(116px, auto)';

export interface LedgerColumn {
  key: IncidentSortKey | 'actions';
  label: (t: Translations) => string;
  align?: 'right';
}

export const LEDGER_COLUMNS: LedgerColumn[] = [
  { key: 'severity', label: (t) => t.overview.incidents.filter_severity_label },
  { key: 'source', label: (t) => t.overview.incidents.filter_source_label },
  { key: 'persona', label: (t) => t.overview.incidents.filter_persona_label },
  { key: 'state', label: (t) => t.overview.incidents.ledger.col_state },
  { key: 'age', label: (t) => t.overview.incidents.ledger.col_age, align: 'right' },
  { key: 'actions', label: (t) => t.overview.incidents.ledger.col_actions, align: 'right' },
];

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
  column, label, sortKey, sortDir, onToggle,
}: {
  column: LedgerColumn;
  label: string;
  sortKey: IncidentSortKey;
  sortDir: SortDirection;
  onToggle: (key: IncidentSortKey) => void;
}) {
  const active = column.key === sortKey;
  const justify = column.align === 'right' ? 'justify-end' : 'justify-start';
  const labelCls = 'typo-caption font-mono uppercase tracking-widest';

  if (column.key === 'actions') {
    return <span className={`flex items-center ${justify} ${labelCls} text-foreground`}>{label}</span>;
  }

  const Arrow = sortDir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(column.key as IncidentSortKey)}
      aria-label={label}
      className={`flex items-center gap-1 ${justify} ${labelCls} rounded-interactive transition-colors focus-ring ${
        active ? 'text-primary' : 'text-foreground hover:text-primary/80'
      }`}
    >
      {label}
      <Arrow className={`h-3 w-3 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
    </button>
  );
}
