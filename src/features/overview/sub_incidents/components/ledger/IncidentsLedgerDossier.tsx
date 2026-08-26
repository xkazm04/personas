// The incidents ledger — "Dossier" (won the 2026-08-26 round-2 A/B over
// Signal / Columns and the round-1 Ledger).
//
// Strategy: SYMBOLS carry the metadata, text carries the incident. Every fact
// on line 2 is an icon-led chip with its own colour family (severity = tonal
// chip, source = glyph badge, agent = avatar-style initials disc, state =
// coloured dot pill, age = clock pill), so the row reads like a case file's
// stamps rather than a spreadsheet's cells. Line 1 uses a real heading scale
// and the source glyph is promoted to a 28px tile at the far left so rows of
// the same kind align visually down the page.

import { memo, useEffect } from 'react';
import { Check, CheckCheck, X, RotateCcw, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { personaInitials } from '@/lib/icons/personaInitials';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import {
  incidentDaysOpen, isStaleIncident, severityBadgeClass,
  severityUrgencyLabel, sourceTableIcon, sourceTableLabel, statusLabel,
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
const STATE_PILL: Record<string, string> = {
  open: 'bg-status-warning',
  acknowledged: 'bg-status-info',
  in_progress: 'bg-status-info',
  resolved: 'bg-status-success',
  dismissed: 'bg-foreground/40',
};
const CASCADE_ROWS = 10;
const SORT_GRID = 'minmax(96px,0.7fr) minmax(120px,1fr) minmax(120px,1.1fr) 120px 72px minmax(116px,auto)';

export function IncidentsLedgerDossier(props: IncidentLedgerViewProps) {
  const { incidents, focusedId, lastSeenAt, onPageRowsChange } = props;
  const { t } = useTranslation();
  const ledger = useIncidentLedger(incidents, { initialSortKey: 'created', initialPageSize: 25 });
  const { page, sortKey, sortDir, toggleSort } = ledger;
  useEffect(() => { onPageRowsChange(page); }, [page, onPageRowsChange]);
  const enter = useRevealTracker(`${sortKey}|${sortDir}|${ledger.pageIndex}|${ledger.pageSize}`);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 grid items-center gap-2 border-y border-primary/10 bg-background/95 px-4 py-1.5 pl-16"
        style={{ gridTemplateColumns: SORT_GRID }} role="row">
        {LEDGER_COLUMNS.map((col) => (
          <LedgerSortHeader key={col.key} column={col} label={col.label(t)} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        ))}
      </div>

      {page.length === 0 ? (
        <p className="px-4 py-10 text-center typo-body text-foreground">{t.overview.incidents.ledger.empty_view}</p>
      ) : (
        <div className="divide-y divide-primary/[0.06]">
          {page.map((incident, index) => (
            <RevealItem key={incident.id} revealId={incident.id} order={index}
              hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)} markEntered={enter.markEntered}>
              <DossierRow incident={incident} focused={focusedId === incident.id} isNew={isNewSince(incident, lastSeenAt)} {...props} />
            </RevealItem>
          ))}
        </div>
      )}

      <LedgerPager pageIndex={ledger.pageIndex} pageCount={ledger.pageCount} pageSize={ledger.pageSize}
        rangeStart={ledger.rangeStart} rangeEnd={ledger.rangeEnd} total={ledger.total}
        onPageChange={ledger.setPageIndex} onPageSizeChange={ledger.setPageSize} />
    </div>
  );
}

const DossierRow = memo(function DossierRow({
  incident, focused, isNew, onOpenDetail, onAcknowledge, onResolve, onDismiss, onReopen,
}: { incident: AuditIncident; focused: boolean; isNew: boolean } & Pick<IncidentLedgerViewProps, 'onOpenDetail' | 'onAcknowledge' | 'onResolve' | 'onDismiss' | 'onReopen'>) {
  const { t } = useTranslation();
  const SourceIcon = sourceTableIcon(incident.sourceTable);
  const isClosed = incident.status === 'resolved' || incident.status === 'dismissed';
  const isOpen = incident.status === 'open';
  const isAck = incident.status === 'acknowledged';
  const stale = isStaleIncident(incident);
  const days = incidentDaysOpen(incident.createdAt);
  const tile = isClosed ? SOURCE_TILE.low! : (SOURCE_TILE[incident.severity] ?? SOURCE_TILE.low!);
  const urgency = severityUrgencyLabel(t, incident.severity);

  return (
    <div id={`incident-row-${incident.id}`} data-testid="incident-row" role="row" onClick={() => onOpenDetail(incident)}
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
        focused ? 'bg-secondary/40 ring-1 ring-inset ring-primary/40' : 'hover:bg-secondary/20'
      }`}>
      {/* Source tile — the case-file stamp. Tinted by severity so kind AND
          urgency read from one symbol. */}
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-card border ${tile}`}
        title={`${sourceTableLabel(t, incident.sourceTable)} · ${urgency}`} aria-label={urgency}>
        <SourceIcon className="h-4 w-4" />
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          {/* Body-lg at NORMAL weight: the source tile and the stamps carry the
              emphasis, so the title reads as prose above them, not a headline. */}
          <span className={`typo-body-lg font-normal ${isClosed ? 'text-foreground/70' : 'text-foreground'}`}>{incident.title}</span>
          <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {isOpen && <Act icon={Check} label={t.overview.incidents.action_acknowledge} onClick={() => onAcknowledge(incident.id)} />}
            {(isOpen || isAck) && <Act icon={CheckCheck} label={t.overview.incidents.action_resolve} onClick={() => onResolve(incident.id)} />}
            {(isOpen || isAck) && <Act icon={X} label={t.overview.incidents.action_dismiss} onClick={() => onDismiss(incident.id)} />}
            {isClosed && <Act icon={RotateCcw} label={t.overview.incidents.action_reopen} onClick={() => onReopen(incident.id)} />}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center rounded-card border px-1.5 py-0.5 typo-caption font-medium ${severityBadgeClass(incident.severity)}`}>
            {tokenLabel(t, 'severity', incident.severity)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-card border border-primary/15 bg-secondary/30 px-1.5 py-0.5 typo-caption text-foreground">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary leading-none">
              {incident.personaName ? personaInitials(incident.personaName) : '·'}
            </span>
            {incident.personaName ?? '—'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-card border border-primary/15 bg-secondary/30 px-1.5 py-0.5 typo-caption text-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${STATE_PILL[incident.status] ?? STATE_PILL.dismissed}`} aria-hidden="true" />
            {statusLabel(t, incident.status)}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-card border px-1.5 py-0.5 typo-caption tabular-nums ${
            stale ? 'border-status-warning/30 bg-status-warning/10 text-status-warning' : 'border-primary/15 bg-secondary/30 text-foreground'
          }`}>
            <Clock className="h-3 w-3" aria-hidden="true" />{days < 1 ? '<1d' : `${days}d`}
          </span>
          {isNew && <span className="inline-flex items-center rounded-card bg-primary/15 px-1.5 py-0.5 typo-caption font-medium text-primary">{t.overview.incidents.ledger.new_badge}</span>}
        </div>
      </div>
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
