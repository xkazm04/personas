// The incidents ledger — "Dossier" (won the 2026-08-26 round-2 A/B over
// Signal / Columns and the round-1 Ledger).
//
// Strategy: SYMBOLS carry the metadata, text carries the incident. Every fact
// is an icon-led stamp with its own colour family (source+severity = the tinted
// case-file tile, severity = tonal chip, agent = avatar-style initials disc,
// age = clock pill), so the row reads like a case file's stamps rather than a
// spreadsheet's cells.
//
// 2026-10-05 — ONE LINE PER INCIDENT. The stamps used to flow on a second line
// under a full-width title, while the sticky header drew six columns above
// them; nothing made the two agree, so the header was decorative and a row cost
// ~94px. The stamps are now CELLS under the header that labels them, so a
// column label sits over the thing it labels and a row costs ~44px. The title
// ellipsizes instead of wrapping (row-height rhythm is sacred, Gate 2b) and
// every header but the last carries a drag handle, which is how the user gets
// more title when they need it.
//
// The grid itself is the shared `UnifiedTable` now (header type, resize, striped
// rows, entrance cascade). This file owns only what is the ledger's: the cells,
// the order (decided by `useIncidentLedger` across ALL pages, hence the table's
// controlled `sort`) and the pager. The header typography and the tag / action
// furniture were lifted FROM this ledger into `TABLE_HEAD_LABEL` and
// `display/TableCells`, so every table now reads like it.
//
// `state` is gone. The KPI strip above the list IS the status filter — Open /
// Critical / Acked / Resolved each narrow the list and read pressed — so a
// per-row status pill restated what the active tile already says.

import { useEffect, useMemo } from 'react';
import { Check, CheckCheck, X, RotateCcw, Clock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { TableActions, TableAction, TableTag } from '@/features/shared/components/display/TableCells';
import { personaInitials } from '@/lib/icons/personaInitials';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import {
  incidentDaysOpen, isStaleIncident, severityBadgeClass,
  severityUrgencyLabel, sourceTableIcon, sourceTableLabel,
} from '../../libs/incidentTaxonomy';
import { useIncidentLedger, type IncidentSortKey } from '../../libs/useIncidentLedger';
import { isClosedIncidentStatus } from '../../libs/incidentStatus';
import { LedgerPager } from './LedgerPager';
import { LEDGER_COLUMNS, isNewSince, type IncidentLedgerViewProps } from './ledgerModel';

const SOURCE_TILE: Record<string, string> = {
  critical: 'border-status-error/40 bg-status-error/15 text-status-error',
  high: 'border-status-warning/40 bg-status-warning/15 text-status-warning',
  medium: 'border-status-info/40 bg-status-info/15 text-status-info',
  low: 'border-primary/20 bg-secondary/50 text-foreground',
};
/**
 * Column widths persist per table id (`table-col-widths:<id>`), so the ledger
 * remembers its layout exactly the way the Events table remembers its own.
 */
const LEDGER_TABLE_ID = 'overview-incidents-ledger';

const isClosed = (incident: AuditIncident) => isClosedIncidentStatus(incident.status);

export function IncidentsLedgerDossier(props: IncidentLedgerViewProps) {
  const { incidents, focusedId, lastSeenAt, onPageRowsChange, footerNote } = props;
  const { onOpenDetail, onAcknowledge, onResolve, onDismiss, onReopen } = props;
  const { t } = useTranslation();
  const ledger = useIncidentLedger(incidents, { initialSortKey: 'created', initialPageSize: 25 });
  const { page, sortKey, sortDir, toggleSort } = ledger;
  useEffect(() => { onPageRowsChange(page); }, [page, onPageRowsChange]);

  const columns = useMemo<TableColumn<AuditIncident>[]>(() => {
    const head = (key: (typeof LEDGER_COLUMNS)[number]['key']) => {
      const c = LEDGER_COLUMNS.find((x) => x.key === key)!;
      return { key, label: c.label(t), width: c.width, align: c.align, sortable: key !== 'actions' };
    };
    return [
      {
        ...head('source'),
        // The case-file stamp, tinted by severity so kind AND urgency read from
        // one symbol. No `title=`: the aria-label carries the sentence.
        render: (incident) => {
          const SourceIcon = sourceTableIcon(incident.sourceTable);
          const tile = isClosed(incident) ? SOURCE_TILE.low! : (SOURCE_TILE[incident.severity] ?? SOURCE_TILE.low!);
          const label = `${sourceTableLabel(t, incident.sourceTable)} · ${severityUrgencyLabel(t, incident.severity)}`;
          return (
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-card border ${tile}`} role="img" aria-label={label}>
              <SourceIcon className="h-3.5 w-3.5" />
            </span>
          );
        },
      },
      {
        ...head('title'),
        // The row's one piece of prose: it truncates rather than wrapping so
        // every row is the same height, and the header's drag handle is how it
        // gets wider. NORMAL weight: the stamps beside it carry the emphasis.
        render: (incident) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className={`truncate typo-body ${isClosed(incident) ? 'text-foreground/70' : 'text-foreground'}`}>{incident.title}</span>
            {isNewSince(incident, lastSeenAt) && (
              <span className="shrink-0 rounded-card bg-primary/15 px-1.5 py-0.5 typo-caption text-primary">
                {t.overview.incidents.ledger.new_badge}
              </span>
            )}
          </span>
        ),
      },
      {
        ...head('severity'),
        render: (incident) => (
          <TableTag className={severityBadgeClass(incident.severity)}>{tokenLabel(t, 'severity', incident.severity)}</TableTag>
        ),
      },
      {
        ...head('persona'),
        render: (incident) => (
          <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary leading-none">
              {incident.personaName ? personaInitials(incident.personaName) : '·'}
            </span>
            <span className="truncate">{incident.personaName ?? '—'}</span>
          </span>
        ),
      },
      {
        ...head('age'),
        render: (incident) => {
          const days = incidentDaysOpen(incident.createdAt);
          return (
            <TableTag
              icon={<Clock className="h-3 w-3" aria-hidden="true" />}
              className={isStaleIncident(incident) ? 'border-status-warning/30 bg-status-warning/10 text-status-warning' : undefined}
            >
              {days < 1 ? '<1d' : `${days}d`}
            </TableTag>
          );
        },
      },
      {
        ...head('actions'),
        render: (incident) => {
          const open = incident.status === 'open';
          const live = open || incident.status === 'acknowledged';
          return (
            <TableActions>
              {open && <TableAction icon={Check} label={t.overview.incidents.action_acknowledge} onClick={() => onAcknowledge(incident.id)} />}
              {live && <TableAction icon={CheckCheck} label={t.overview.incidents.action_resolve} onClick={() => onResolve(incident.id)} />}
              {live && <TableAction icon={X} label={t.overview.incidents.action_dismiss} onClick={() => onDismiss(incident.id)} />}
              {isClosed(incident) && <TableAction icon={RotateCcw} label={t.overview.incidents.action_reopen} onClick={() => onReopen(incident.id)} />}
            </TableActions>
          );
        },
      },
    ];
  }, [t, lastSeenAt, onAcknowledge, onResolve, onDismiss, onReopen]);

  return (
    <div className="flex flex-col">
      <UnifiedTable<AuditIncident>
        columns={columns}
        data={page}
        getRowKey={(incident) => incident.id}
        onRowClick={onOpenDetail}
        // Triage keys are owned by useIncidentKeyboardTriage; the table must
        // not grow a second arrow-key cursor beside them.
        keyboardNav={false}
        activeKey={focusedId}
        rowAttrs={(incident) => ({ id: `incident-row-${incident.id}`, testId: 'incident-row' })}
        sort={{ key: sortKey, dir: sortDir, onSort: (key) => toggleSort(key as IncidentSortKey) }}
        tableId={LEDGER_TABLE_ID}
        density="compact"
        borderless
        emptyTitle={t.overview.incidents.ledger.empty_view}
        emptyArt="inbox"
      />

      <LedgerPager pageIndex={ledger.pageIndex} pageCount={ledger.pageCount} pageSize={ledger.pageSize}
        rangeStart={ledger.rangeStart} rangeEnd={ledger.rangeEnd} total={ledger.total}
        onPageChange={ledger.setPageIndex} onPageSizeChange={ledger.setPageSize} note={footerNote} />
    </div>
  );
}
