/**
 * Column layout for the incidents table — shared between the sticky column
 * header (`IncidentTableHeader`) and each `IncidentRow` so their CSS grid
 * tracks line up exactly. Widths are defaults; users can drag-resize them and
 * the overrides persist under `useColumnWidths(INCIDENT_TABLE_ID)`.
 *
 * Severity is intentionally NOT a column — it reads from the row's left gutter
 * accent + the severity shape/colored source glyph in the Incident cell (the
 * priority text tag was removed), so the columns are the dimensions a user
 * actually filters/sorts by.
 */
export const INCIDENT_TABLE_ID = 'overview-incidents';

export const INCIDENT_COLUMNS: { key: string; width: string }[] = [
  { key: 'incident', width: 'minmax(260px, 2.4fr)' },
  { key: 'persona', width: 'minmax(140px, 1fr)' },
  { key: 'state', width: '128px' },
  { key: 'days', width: '88px' },
  { key: 'actions', width: 'minmax(132px, auto)' },
];
