// Prototype variant C — "Columns"
//
// Strategy: a true table, but with TYPOGRAPHIC HIERARCHY inside the cells.
// Line 1 is the title at typo-body-lg spanning the grid; line 2 keeps strict
// columns (so sorting reads as sorting) but each column has its own voice:
// severity as a solid coloured block with white text, source as glyph+label,
// agent as bold, state as a dot+word, age as a big tabular numeral. Column
// headers are real sortable headers over the SAME grid, so header and cell
// line up and the user's eye can scan a column top-to-bottom.

import { memo, useEffect } from 'react';
import { Check, CheckCheck, X, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import {
  incidentDaysOpen, isStaleIncident, severityUrgencyLabel,
  sourceTableIcon, sourceTableLabel, statusLabel,
} from '../../libs/incidentTaxonomy';
import { useIncidentLedger } from '../../libs/useIncidentLedger';
import { LedgerPager } from './LedgerPager';
import { LEDGER_COLUMNS, LEDGER_GRID, LedgerSortHeader, isNewSince, type IncidentLedgerViewProps } from './ledgerModel';

/** Solid severity block — white-on-colour so it is the loudest cell in the row. */
const SEVERITY_BLOCK: Record<string, string> = {
  critical: 'bg-status-error text-background',
  high: 'bg-status-warning text-background',
  medium: 'bg-status-info text-background',
  low: 'bg-secondary text-foreground border border-primary/20',
};
const STATE_DOT: Record<string, string> = {
  open: 'bg-status-warning',
  acknowledged: 'bg-status-info',
  in_progress: 'bg-status-info',
  resolved: 'bg-status-success',
  dismissed: 'bg-foreground/40',
};
const CASCADE_ROWS = 12;

export function IncidentsLedgerColumns(props: IncidentLedgerViewProps) {
  const { incidents, focusedId, lastSeenAt, onPageRowsChange } = props;
  const { t } = useTranslation();
  const ledger = useIncidentLedger(incidents, { initialSortKey: 'severity', initialPageSize: 25 });
  const { page, sortKey, sortDir, toggleSort } = ledger;
  useEffect(() => { onPageRowsChange(page); }, [page, onPageRowsChange]);
  const enter = useRevealTracker(`${sortKey}|${sortDir}|${ledger.pageIndex}|${ledger.pageSize}`);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 grid items-center gap-3 border-y border-primary/10 bg-primary/5 px-4 py-2"
        style={{ gridTemplateColumns: LEDGER_GRID }} role="row">
        {LEDGER_COLUMNS.map((col) => (
          <LedgerSortHeader key={col.key} column={col} label={col.label(t)} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        ))}
      </div>

      {page.length === 0 ? (
        <p className="px-4 py-10 text-center typo-body text-foreground">{t.overview.incidents.ledger.empty_view}</p>
      ) : (
        <div>
          {page.map((incident, index) => (
            <RevealItem key={incident.id} revealId={incident.id} order={index}
              hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)} markEntered={enter.markEntered}>
              <ColumnsRow incident={incident} zebra={index % 2 === 1} focused={focusedId === incident.id} isNew={isNewSince(incident, lastSeenAt)} {...props} />
            </RevealItem>
          ))}
        </div>
      )}

      <LedgerPager dense pageIndex={ledger.pageIndex} pageCount={ledger.pageCount} pageSize={ledger.pageSize}
        rangeStart={ledger.rangeStart} rangeEnd={ledger.rangeEnd} total={ledger.total}
        onPageChange={ledger.setPageIndex} onPageSizeChange={ledger.setPageSize} />
    </div>
  );
}

const ColumnsRow = memo(function ColumnsRow({
  incident, zebra, focused, isNew, onOpenDetail, onAcknowledge, onResolve, onDismiss, onReopen,
}: { incident: AuditIncident; zebra: boolean; focused: boolean; isNew: boolean } & Pick<IncidentLedgerViewProps, 'onOpenDetail' | 'onAcknowledge' | 'onResolve' | 'onDismiss' | 'onReopen'>) {
  const { t } = useTranslation();
  const SourceIcon = sourceTableIcon(incident.sourceTable);
  const isClosed = incident.status === 'resolved' || incident.status === 'dismissed';
  const isOpen = incident.status === 'open';
  const isAck = incident.status === 'acknowledged';
  const stale = isStaleIncident(incident);
  const days = incidentDaysOpen(incident.createdAt);
  const block = isClosed ? SEVERITY_BLOCK.low! : (SEVERITY_BLOCK[incident.severity] ?? SEVERITY_BLOCK.low!);

  return (
    <div id={`incident-row-${incident.id}`} data-testid="incident-row" role="row" onClick={() => onOpenDetail(incident)}
      className={`cursor-pointer border-b border-b-primary/[0.06] px-4 pt-2.5 pb-2 transition-colors ${
        focused ? 'bg-secondary/40 ring-1 ring-inset ring-primary/40' : zebra ? 'bg-primary/[0.025] hover:bg-secondary/25' : 'hover:bg-secondary/25'
      }`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`typo-body-lg ${isClosed ? 'text-foreground/70' : 'text-foreground font-medium'}`}>{incident.title}</span>
        {isNew && <span className="shrink-0 rounded-card bg-primary/15 px-1.5 py-0.5 typo-caption font-medium text-primary">{t.overview.incidents.ledger.new_badge}</span>}
        {stale && <span className="shrink-0 rounded-card bg-status-warning/15 px-1.5 py-0.5 typo-caption font-medium text-status-warning">{t.overview.incidents.stale_label}</span>}
      </div>
      <div className="grid items-center gap-3" style={{ gridTemplateColumns: LEDGER_GRID }}>
        <span className={`inline-flex w-fit items-center rounded-interactive px-2 py-0.5 typo-caption font-semibold uppercase tracking-wider ${block}`}
          title={severityUrgencyLabel(t, incident.severity)}>
          {tokenLabel(t, 'severity', incident.severity)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 typo-body text-foreground">
          <SourceIcon className="h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden="true" />
          <span className="truncate">{sourceTableLabel(t, incident.sourceTable)}</span>
        </span>
        <span className="truncate typo-body font-semibold text-foreground">{incident.personaName ?? '—'}</span>
        <span className="flex min-w-0 items-center gap-1.5 typo-body text-foreground">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[incident.status] ?? STATE_DOT.dismissed}`} aria-hidden="true" />
          <span className="truncate">{statusLabel(t, incident.status)}</span>
        </span>
        <span className={`text-right typo-data tabular-nums ${stale ? 'text-status-warning' : 'text-foreground'}`}>
          {days < 1 ? '<1d' : `${days}d`}
        </span>
        <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {isOpen && <Act icon={Check} label={t.overview.incidents.action_acknowledge} onClick={() => onAcknowledge(incident.id)} />}
          {(isOpen || isAck) && <Act icon={CheckCheck} label={t.overview.incidents.action_resolve} onClick={() => onResolve(incident.id)} />}
          {(isOpen || isAck) && <Act icon={X} label={t.overview.incidents.action_dismiss} onClick={() => onDismiss(incident.id)} />}
          {isClosed && <Act icon={RotateCcw} label={t.overview.incidents.action_reopen} onClick={() => onReopen(incident.id)} />}
        </span>
      </div>
    </div>
  );
});

function Act({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="rounded-card border border-primary/15 p-1 text-foreground transition-colors hover:bg-secondary/50 focus-ring">
      <Icon className="h-3 w-3" />
    </button>
  );
}
