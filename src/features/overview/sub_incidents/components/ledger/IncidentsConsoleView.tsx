// Prototype variant B — "Console"
//
// Metaphor: a triage console / dossier stack. Same flat, paginated, two-row
// model as the Ledger, but each incident is its own surfaced band: severity
// paints a left rail and (for critical/high) a faint wash across the card, the
// title gets room to breathe on line 1 with named actions at its right, and
// line 2 carries labelled metadata aligned to the sortable header. Optimised
// for reading and deciding on one incident at a time.

import { memo, useEffect } from 'react';
import { Check, CheckCheck, X, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import {
  incidentDaysOpen, isStaleIncident, severityShapeStatus, severityUrgencyLabel,
  sourceTableIcon, sourceTableLabel, statusLabel,
} from '../../libs/incidentTaxonomy';
import { useIncidentLedger } from '../../libs/useIncidentLedger';
import { LedgerPager } from './LedgerPager';
import {
  LEDGER_COLUMNS, LEDGER_GRID, LEDGER_COPY, LedgerSortHeader,
  isNewSince, type IncidentLedgerViewProps,
} from './ledgerModel';

const CASCADE_ROWS = 10;

/** Severity → left rail, card wash, and the severity chip's own colours. */
const SEVERITY_SKIN: Record<string, { rail: string; wash: string; chip: string }> = {
  critical: {
    rail: 'bg-status-error',
    wash: 'bg-status-error/[0.06]',
    chip: 'border-status-error/30 bg-status-error/10 text-status-error',
  },
  high: {
    rail: 'bg-status-warning',
    wash: 'bg-status-warning/[0.05]',
    chip: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  },
  medium: {
    rail: 'bg-status-info',
    wash: '',
    chip: 'border-status-info/30 bg-status-info/10 text-status-info',
  },
  low: {
    rail: 'bg-foreground/30',
    wash: '',
    chip: 'border-primary/20 bg-secondary/40 text-foreground',
  },
};
const DEFAULT_SKIN = SEVERITY_SKIN.low!;

const STATE_DOT: Record<string, string> = {
  open: 'bg-status-warning',
  acknowledged: 'bg-status-info',
  in_progress: 'bg-status-info',
  resolved: 'bg-status-success',
  dismissed: 'bg-foreground/40',
};

export function IncidentsConsoleView({
  incidents, focusedId, lastSeenAt, onOpenDetail,
  onAcknowledge, onResolve, onDismiss, onReopen, onPageRowsChange,
}: IncidentLedgerViewProps) {
  const ledger = useIncidentLedger(incidents, { initialSortKey: 'severity', initialPageSize: 25 });
  const { page, sortKey, sortDir, toggleSort } = ledger;

  useEffect(() => { onPageRowsChange(page); }, [page, onPageRowsChange]);

  const enter = useRevealTracker(`${sortKey}|${sortDir}|${ledger.pageIndex}|${ledger.pageSize}`);

  return (
    <div className="flex flex-col">
      {/* Sort strip — the same six columns the metadata line below aligns to.
          Indented past the rail + chip gutter so labels sit over their values. */}
      <div
        className="sticky top-0 z-10 grid items-center gap-3 border-y border-primary/10 bg-background/95 px-4 py-2 pl-7"
        style={{ gridTemplateColumns: LEDGER_GRID }}
        role="row"
      >
        {LEDGER_COLUMNS.map((col) => (
          <LedgerSortHeader key={col.key} column={col} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        ))}
      </div>

      {page.length === 0 ? (
        <p className="px-4 py-10 text-center typo-body text-foreground">{LEDGER_COPY.empty}</p>
      ) : (
        <div className="flex flex-col gap-1.5 px-3 py-2">
          {page.map((incident, index) => (
            <RevealItem
              key={incident.id}
              revealId={incident.id}
              order={index}
              hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)}
              markEntered={enter.markEntered}
            >
              <ConsoleCard
                incident={incident}
                focused={focusedId === incident.id}
                isNew={isNewSince(incident, lastSeenAt)}
                onOpenDetail={onOpenDetail}
                onAcknowledge={onAcknowledge}
                onResolve={onResolve}
                onDismiss={onDismiss}
                onReopen={onReopen}
              />
            </RevealItem>
          ))}
        </div>
      )}

      <LedgerPager
        pageIndex={ledger.pageIndex}
        pageCount={ledger.pageCount}
        pageSize={ledger.pageSize}
        rangeStart={ledger.rangeStart}
        rangeEnd={ledger.rangeEnd}
        total={ledger.total}
        onPageChange={ledger.setPageIndex}
        onPageSizeChange={ledger.setPageSize}
      />
    </div>
  );
}

const ConsoleCard = memo(function ConsoleCard({
  incident, focused, isNew, onOpenDetail, onAcknowledge, onResolve, onDismiss, onReopen,
}: {
  incident: AuditIncident;
  focused: boolean;
  isNew: boolean;
  onOpenDetail: (incident: AuditIncident) => void;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
  onReopen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const SourceIcon = sourceTableIcon(incident.sourceTable);
  const isClosed = incident.status === 'resolved' || incident.status === 'dismissed';
  const skin = isClosed ? DEFAULT_SKIN : (SEVERITY_SKIN[incident.severity] ?? DEFAULT_SKIN);
  const stale = isStaleIncident(incident);
  const days = incidentDaysOpen(incident.createdAt);
  const isOpen = incident.status === 'open';
  const isAcknowledged = incident.status === 'acknowledged';
  const urgency = severityUrgencyLabel(t, incident.severity);
  const shape = severityShapeStatus(incident.severity);

  return (
    <div
      id={`incident-row-${incident.id}`}
      data-testid="incident-row"
      role="row"
      onClick={() => onOpenDetail(incident)}
      className={`group relative cursor-pointer overflow-hidden rounded-card border transition-colors ${
        focused
          ? 'border-primary/40 bg-secondary/40 ring-1 ring-inset ring-primary/40'
          : `border-primary/10 hover:border-primary/25 ${isClosed || shape === 'neutral' ? 'bg-secondary/20' : `${skin.wash} hover:bg-secondary/30`}`
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${isClosed ? 'bg-foreground/20' : skin.rail}`} aria-hidden="true" />

      {/* Line 1 — title, flags, and named actions */}
      <div className="flex items-start justify-between gap-3 pl-4 pr-3 pt-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="typo-body font-medium text-foreground">{incident.title}</span>
          {isNew && (
            <span className="shrink-0 rounded-card border border-primary/25 bg-primary/10 px-1.5 py-0.5 typo-caption text-primary">
              {LEDGER_COPY.new}
            </span>
          )}
          {stale && (
            <span className="shrink-0 rounded-card border border-status-warning/30 px-1.5 py-0.5 typo-caption text-status-warning">
              {t.overview.incidents.stale_label}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {isOpen && <ConsoleAction icon={Check} label={t.overview.incidents.action_acknowledge} onClick={() => onAcknowledge(incident.id)} />}
          {(isOpen || isAcknowledged) && <ConsoleAction icon={CheckCheck} label={t.overview.incidents.action_resolve} onClick={() => onResolve(incident.id)} />}
          {(isOpen || isAcknowledged) && <ConsoleAction icon={X} label={t.overview.incidents.action_dismiss} onClick={() => onDismiss(incident.id)} />}
          {isClosed && <ConsoleAction icon={RotateCcw} label={t.overview.incidents.action_reopen} onClick={() => onReopen(incident.id)} />}
        </div>
      </div>

      {/* Line 2 — metadata under the sort strip's columns */}
      <div
        className="grid items-center gap-3 pl-4 pr-3 pb-2.5 pt-1.5"
        style={{ gridTemplateColumns: LEDGER_GRID }}
      >
        <span
          className={`inline-flex w-fit items-center rounded-card border px-1.5 py-0.5 typo-caption ${skin.chip}`}
          title={urgency}
        >
          {tokenLabel(t, 'severity', incident.severity)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground">
          <SourceIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{sourceTableLabel(t, incident.sourceTable)}</span>
        </span>
        <span className="truncate typo-caption text-foreground">{incident.personaName ?? '—'}</span>
        <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[incident.status] ?? 'bg-foreground/40'}`} aria-hidden="true" />
          <span className="truncate">{statusLabel(t, incident.status)}</span>
        </span>
        <span
          className={`text-right typo-caption tabular-nums ${stale ? 'text-status-warning' : 'text-foreground'}`}
          title={incident.createdAt}
        >
          {days < 1 ? '<1d' : `${days}d`}
        </span>
        <RelativeTime timestamp={incident.createdAt} className="text-right typo-caption text-foreground" />
      </div>
    </div>
  );
});

function ConsoleAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-card border border-primary/15 bg-secondary/30 px-2 py-1 typo-caption text-foreground opacity-70 transition-all hover:bg-secondary/60 hover:opacity-100 group-hover:opacity-100 focus-ring"
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
