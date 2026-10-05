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
// ~94px. The stamps are now CELLS in the same grid the header composes
// (`LEDGER_COLUMNS` + `useColumnWidths().template`), so a column label sits over
// the thing it labels and a row costs ~44px — twice the incidents per screen.
// The title ellipsizes instead of wrapping (row-height rhythm is sacred, Gate
// 2b) and every header but the last carries a drag handle, which is how the
// user gets more title when they need it.
//
// `state` is gone. The KPI strip above the list IS the status filter — Open /
// Critical / Acked / Resolved each narrow the list and read pressed — so a
// per-row status pill restated what the active tile already says.

import { memo, useEffect } from 'react';
import { Check, CheckCheck, X, RotateCcw, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useColumnWidths, ColumnResizeHandle } from '@/features/shared/components/display/ColumnResize';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { personaInitials } from '@/lib/icons/personaInitials';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import {
  incidentDaysOpen, isStaleIncident, severityBadgeClass,
  severityUrgencyLabel, sourceTableIcon, sourceTableLabel,
} from '../../libs/incidentTaxonomy';
import { useIncidentLedger } from '../../libs/useIncidentLedger';
import { LedgerPager } from './LedgerPager';
import { LEDGER_COLUMNS, LedgerSortHeader, isNewSince, type IncidentLedgerViewProps } from './ledgerModel';

const SOURCE_TILE: Record<string, string> = {
  critical: 'border-status-error/40 bg-status-error/15 text-status-error',
  high: 'border-status-warning/40 bg-status-warning/15 text-status-warning',
  medium: 'border-status-info/40 bg-status-info/15 text-status-info',
  low: 'border-primary/20 bg-secondary/50 text-foreground',
};
const CASCADE_ROWS = 10;
/**
 * Column widths persist per table id, in the same namespace UnifiedTable uses
 * (`table-col-widths:<id>`), so the ledger remembers its layout exactly the way
 * the Events table remembers its own.
 */
const LEDGER_TABLE_ID = 'overview-incidents-ledger';

export function IncidentsLedgerDossier(props: IncidentLedgerViewProps) {
  const { incidents, focusedId, lastSeenAt, onPageRowsChange, footerNote } = props;
  const { t } = useTranslation();
  const ledger = useIncidentLedger(incidents, { initialSortKey: 'created', initialPageSize: 25 });
  const { page, sortKey, sortDir, toggleSort } = ledger;
  useEffect(() => { onPageRowsChange(page); }, [page, onPageRowsChange]);
  const enter = useRevealTracker(`${sortKey}|${sortDir}|${ledger.pageIndex}|${ledger.pageSize}`);
  const resize = useColumnWidths(LEDGER_TABLE_ID);
  const gridTemplate = resize.template(LEDGER_COLUMNS);

  return (
    <div className={`flex flex-col ${resize.isResizing ? 'cursor-col-resize select-none' : ''}`}>
      <div
        className="sticky top-0 z-10 grid items-center gap-2 border-y border-primary/10 bg-background/95 px-4 py-1.5"
        style={{ gridTemplateColumns: gridTemplate }}
        role="row"
      >
        {LEDGER_COLUMNS.map((col, i) => (
          <LedgerSortHeader
            key={col.key}
            column={col}
            label={col.label(t)}
            sortKey={sortKey}
            sortDir={sortDir}
            onToggle={toggleSort}
            resizeHandle={i < LEDGER_COLUMNS.length - 1 ? (
              <ColumnResizeHandle
                label={t.shared.resize_column}
                onBeginResize={(w, x) => resize.beginResize(col.key, w, x)}
                onReset={() => resize.clearColumn(col.key)}
              />
            ) : null}
          />
        ))}
      </div>

      {page.length === 0 ? (
        <p className="px-4 py-10 text-center typo-body text-foreground">{t.overview.incidents.ledger.empty_view}</p>
      ) : (
        <div className="divide-y divide-primary/[0.06]">
          {page.map((incident, index) => (
            <RevealItem key={incident.id} revealId={incident.id} order={index}
              hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)} markEntered={enter.markEntered}>
              <DossierRow incident={incident} focused={focusedId === incident.id} isNew={isNewSince(incident, lastSeenAt)}
                gridTemplate={gridTemplate} {...props} />
            </RevealItem>
          ))}
        </div>
      )}

      <LedgerPager pageIndex={ledger.pageIndex} pageCount={ledger.pageCount} pageSize={ledger.pageSize}
        rangeStart={ledger.rangeStart} rangeEnd={ledger.rangeEnd} total={ledger.total}
        onPageChange={ledger.setPageIndex} onPageSizeChange={ledger.setPageSize} note={footerNote} />
    </div>
  );
}

const DossierRow = memo(function DossierRow({
  incident, focused, isNew, gridTemplate, onOpenDetail, onAcknowledge, onResolve, onDismiss, onReopen,
}: { incident: AuditIncident; focused: boolean; isNew: boolean; gridTemplate: string }
  & Pick<IncidentLedgerViewProps, 'onOpenDetail' | 'onAcknowledge' | 'onResolve' | 'onDismiss' | 'onReopen'>) {
  const { t } = useTranslation();
  const SourceIcon = sourceTableIcon(incident.sourceTable);
  const isClosed = incident.status === 'resolved' || incident.status === 'dismissed';
  const isOpen = incident.status === 'open';
  const isAck = incident.status === 'acknowledged';
  const stale = isStaleIncident(incident);
  const days = incidentDaysOpen(incident.createdAt);
  const tile = isClosed ? SOURCE_TILE.low! : (SOURCE_TILE[incident.severity] ?? SOURCE_TILE.low!);
  const urgency = severityUrgencyLabel(t, incident.severity);
  const source = sourceTableLabel(t, incident.sourceTable);

  return (
    <div
      id={`incident-row-${incident.id}`}
      data-testid="incident-row"
      role="row"
      onClick={() => onOpenDetail(incident)}
      style={{ gridTemplateColumns: gridTemplate }}
      className={`grid items-center gap-2 px-4 py-2 cursor-pointer transition-colors ${
        focused ? 'bg-secondary/40 ring-1 ring-inset ring-primary/40' : 'hover:bg-secondary/20'
      }`}
    >
      {/* Source tile — the case-file stamp. Tinted by severity so kind AND
          urgency read from one symbol. It has its own column now, so it is also
          the cell the SOURCE header labels. */}
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-card border ${tile}`}
        title={`${source} · ${urgency}`} aria-label={`${source} · ${urgency}`}>
        <SourceIcon className="h-3.5 w-3.5" />
      </span>

      {/* The title is the row's one piece of prose and the column that has to
          breathe — it truncates rather than wrapping so every row is the same
          height, and the header's drag handle is how it gets wider. White text,
          so NORMAL weight: the stamps beside it carry the emphasis.
          No `title=` attribute: a native tooltip is a golden-path violation
          (`native-title-tooltip`), and the two real doors to the full sentence
          are already here — drag the column wider, or click the row and read
          it in the detail modal. */}
      <span className="flex min-w-0 items-center gap-2">
        <span className={`truncate typo-body ${isClosed ? 'text-foreground/70' : 'text-foreground'}`}>
          {incident.title}
        </span>
        {isNew && (
          <span className="shrink-0 rounded-card bg-primary/15 px-1.5 py-0.5 typo-caption text-primary">
            {t.overview.incidents.ledger.new_badge}
          </span>
        )}
      </span>

      <span className="flex min-w-0">
        <span className={`inline-flex max-w-full items-center truncate rounded-card border px-1.5 py-0.5 typo-caption ${severityBadgeClass(incident.severity)}`}>
          {tokenLabel(t, 'severity', incident.severity)}
        </span>
      </span>

      <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary leading-none">
          {incident.personaName ? personaInitials(incident.personaName) : '·'}
        </span>
        <span className="truncate">{incident.personaName ?? '—'}</span>
      </span>

      <span className="flex justify-end">
        <span className={`inline-flex items-center gap-1 rounded-card border px-1.5 py-0.5 typo-caption tabular-nums ${
          stale ? 'border-status-warning/30 bg-status-warning/10 text-status-warning' : 'border-primary/15 bg-secondary/30 text-foreground'
        }`}>
          <Clock className="h-3 w-3" aria-hidden="true" />{days < 1 ? '<1d' : `${days}d`}
        </span>
      </span>

      <span className="flex shrink-0 items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {isOpen && <Act icon={Check} label={t.overview.incidents.action_acknowledge} onClick={() => onAcknowledge(incident.id)} />}
        {(isOpen || isAck) && <Act icon={CheckCheck} label={t.overview.incidents.action_resolve} onClick={() => onResolve(incident.id)} />}
        {(isOpen || isAck) && <Act icon={X} label={t.overview.incidents.action_dismiss} onClick={() => onDismiss(incident.id)} />}
        {isClosed && <Act icon={RotateCcw} label={t.overview.incidents.action_reopen} onClick={() => onReopen(incident.id)} />}
      </span>
    </div>
  );
});

function Act({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="rounded-card border border-primary/15 p-1 text-foreground transition-colors hover:bg-secondary/50 focus-ring">
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
