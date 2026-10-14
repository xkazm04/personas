// Shared model for the incidents ledger: the sortable column set with its own
// widths (so the sticky column header and the rows below it compose the SAME
// grid template and can never drift).
//
// 2026-10-05: the ledger became a real one-line table. Every column now has a
// CELL under it — before this, `source` had a header and no cell, and the
// metadata lived on a free-flowing second line that landed nowhere near the
// headers above it. `state` is gone entirely: the KPI strip above the list is
// the status filter (Open / Critical / Acked / Resolved), so a per-row status
// value was a column spent restating what the active tile already says.

import type { ReactNode } from 'react';
import type { Translations } from '@/i18n/generated/types';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import type { IncidentSortKey } from '../../libs/useIncidentLedger';

export interface LedgerColumn {
  key: IncidentSortKey | 'actions';
  label: (t: Translations) => string;
  /** CSS grid track, composed by `useColumnWidths().template`. */
  width: string;
  align?: 'right';
}

/**
 * The ledger's columns, in reading order.
 *
 * `source` is the case-file tile (the symbol that carries source AND severity
 * tint — the 2026-08-26 A/B winner), so it is a narrow fixed stamp column.
 * `title` is the one that has to breathe, which is exactly why the header is
 * drag-resizable: the title ellipsizes at the column's width and the user
 * widens it when they need the rest of the sentence. Row height never grows
 * with the title (row-height rhythm, Gate 2b).
 */
export const LEDGER_COLUMNS: LedgerColumn[] = [
  { key: 'source', label: (t) => t.overview.incidents.filter_source_label, width: '108px' },
  { key: 'title', label: (t) => t.overview.incidents.col_incident, width: 'minmax(220px, 2.6fr)' },
  { key: 'severity', label: (t) => t.overview.incidents.filter_severity_label, width: 'minmax(96px, 0.5fr)' },
  { key: 'persona', label: (t) => t.overview.incidents.filter_persona_label, width: 'minmax(140px, 1fr)' },
  { key: 'age', label: (t) => t.overview.incidents.ledger.col_age, width: '88px', align: 'right' },
  { key: 'actions', label: (t) => t.overview.incidents.ledger.col_actions, width: 'minmax(112px, auto)', align: 'right' },
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
  /**
   * A caveat about the rows themselves — today, the server-side cap notice.
   * It belongs in the pager's footer, under the last row, beside the range it
   * qualifies; above the column header (where it used to sit) it read as a
   * page-level banner and pushed the table down. Omitted when there is none.
   */
  footerNote?: ReactNode;
}

/** True when the incident arrived after the user last marked the inbox seen. */
export function isNewSince(incident: AuditIncident, lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  const cutoff = Date.parse(lastSeenAt);
  return !Number.isNaN(cutoff) && Date.parse(incident.createdAt) > cutoff;
}
