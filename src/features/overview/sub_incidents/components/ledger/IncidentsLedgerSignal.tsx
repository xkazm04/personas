// Prototype variant A — "Signal"
//
// Strategy: ONE loud thing per row, everything else quiet. The title is the
// only body-weight text; severity is not a text chip at all but a saturated
// 4px rail + a filled StatusShape, so the eye ranks rows by colour before it
// reads a word. Metadata goes into a single muted mono line where each fact
// is a `label·value` pair — labels at 60% so the values (agent name, state,
// age) pop against them. Age turns into a real number (a big tabular numeral
// at the right edge) because "how long has this been rotting" is the second
// question after "how bad".

import { memo, useEffect } from 'react';
import { Check, CheckCheck, X, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import {
  incidentDaysOpen, isStaleIncident, severityShapeStatus,
  severityUrgencyLabel, sourceTableIcon, sourceTableLabel, statusLabel,
} from '../../libs/incidentTaxonomy';
import { useIncidentLedger } from '../../libs/useIncidentLedger';
import { LedgerPager } from './LedgerPager';
import { LEDGER_COLUMNS, LedgerSortHeader, isNewSince, type IncidentLedgerViewProps } from './ledgerModel';

/** Rail + shape colour per severity — the whole severity vocabulary. */
const RAIL: Record<string, string> = {
  critical: 'bg-status-error',
  high: 'bg-status-warning',
  medium: 'bg-status-info',
  low: 'bg-foreground/25',
};

const STATE_TONE: Record<string, string> = {
  open: 'text-status-warning',
  acknowledged: 'text-status-info',
  in_progress: 'text-status-info',
  resolved: 'text-status-success',
  dismissed: 'text-foreground/50',
};

const CASCADE_ROWS = 12;
const SORT_GRID = 'minmax(96px,0.7fr) minmax(120px,1fr) minmax(120px,1.1fr) 120px 72px minmax(116px,auto)';

export function IncidentsLedgerSignal(props: IncidentLedgerViewProps) {
  const { incidents, focusedId, lastSeenAt, onPageRowsChange } = props;
  const { t } = useTranslation();
  const ledger = useIncidentLedger(incidents, { initialSortKey: 'severity', initialPageSize: 25 });
  const { page, sortKey, sortDir, toggleSort } = ledger;
  useEffect(() => { onPageRowsChange(page); }, [page, onPageRowsChange]);
  const enter = useRevealTracker(`${sortKey}|${sortDir}|${ledger.pageIndex}|${ledger.pageSize}`);

  return (
    <div className="flex flex-col">
      {/* Sort strip only — no column grid on rows, so this is a toolbar of
          sort keys rather than a table header that rows must line up to. */}
      <div
        className="sticky top-0 z-10 grid items-center gap-2 border-y border-primary/10 bg-background/95 px-4 py-1.5"
        style={{ gridTemplateColumns: SORT_GRID }}
        role="row"
      >
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
              <SignalRow incident={incident} focused={focusedId === incident.id} isNew={isNewSince(incident, lastSeenAt)} {...props} />
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

const SignalRow = memo(function SignalRow({
  incident, focused, isNew, onOpenDetail, onAcknowledge, onResolve, onDismiss, onReopen,
}: { incident: AuditIncident; focused: boolean; isNew: boolean } & Pick<IncidentLedgerViewProps, 'onOpenDetail' | 'onAcknowledge' | 'onResolve' | 'onDismiss' | 'onReopen'>) {
  const { t } = useTranslation();
  const SourceIcon = sourceTableIcon(incident.sourceTable);
  const isClosed = incident.status === 'resolved' || incident.status === 'dismissed';
  const isOpen = incident.status === 'open';
  const isAck = incident.status === 'acknowledged';
  const stale = isStaleIncident(incident);
  const days = incidentDaysOpen(incident.createdAt);
  const rail = isClosed ? 'bg-foreground/15' : (RAIL[incident.severity] ?? RAIL.low!);
  const urgency = severityUrgencyLabel(t, incident.severity);
  const Fact = ({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) => (
    <span className="inline-flex items-baseline gap-1 min-w-0">
      {/* muted-ok: the label half of a label·value pair — the value carries the reading */}
      <span className="typo-caption font-mono uppercase tracking-wider text-foreground/55 shrink-0">{label}</span>
      <span className={`typo-caption font-mono truncate ${tone ?? 'text-foreground'}`}>{children}</span>
    </span>
  );

  return (
    <div
      id={`incident-row-${incident.id}`}
      data-testid="incident-row"
      role="row"
      onClick={() => onOpenDetail(incident)}
      className={`relative flex items-stretch cursor-pointer border-b border-b-primary/[0.06] transition-colors ${
        focused ? 'bg-secondary/40 ring-1 ring-inset ring-primary/40' : 'hover:bg-secondary/20'
      }`}
    >
      <span className={`w-1 shrink-0 ${rail}`} aria-hidden="true" />
      <div className="flex-1 min-w-0 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <StatusShape status={isClosed ? 'neutral' : severityShapeStatus(incident.severity)} size="sm" title={urgency} aria-label={urgency} />
          <span className={`typo-body-lg text-foreground truncate ${isClosed ? 'text-foreground/70' : 'font-medium'}`}>{incident.title}</span>
          {isNew && <span className="shrink-0 rounded-card bg-primary/15 px-1.5 py-0.5 typo-caption text-primary">{t.overview.incidents.ledger.new_badge}</span>}
          {stale && <span className="shrink-0 rounded-card bg-status-warning/15 px-1.5 py-0.5 typo-caption text-status-warning">{t.overview.incidents.stale_label}</span>}
        </div>
        <div className="mt-1 flex items-center gap-x-4 gap-y-1 flex-wrap pl-[1.65rem]">
          <Fact label={t.overview.incidents.filter_severity_label}>{tokenLabel(t, 'severity', incident.severity)}</Fact>
          <Fact label={t.overview.incidents.filter_source_label}>
            <span className="inline-flex items-center gap-1"><SourceIcon className="h-3 w-3" aria-hidden="true" />{sourceTableLabel(t, incident.sourceTable)}</span>
          </Fact>
          <Fact label={t.overview.incidents.filter_persona_label}>{incident.personaName ?? '—'}</Fact>
          <Fact label={t.overview.incidents.ledger.col_state} tone={STATE_TONE[incident.status]}>{statusLabel(t, incident.status)}</Fact>
        </div>
      </div>
      {/* Age as a numeral — the second thing the eye should rank rows by. */}
      <div className="flex flex-col items-end justify-center gap-1 px-4 shrink-0">
        <span className={`typo-data-lg tabular-nums leading-none ${stale ? 'text-status-warning' : 'text-foreground'}`}>
          {days < 1 ? '<1' : days}<span className="typo-caption text-foreground/55 ml-0.5">d</span>
        </span>
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
      className="rounded-card p-1 text-foreground/60 transition-colors hover:bg-secondary/60 hover:text-foreground focus-ring">
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
