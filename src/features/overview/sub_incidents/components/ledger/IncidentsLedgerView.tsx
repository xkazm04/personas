// Prototype variant A — "Ledger"
//
// Metaphor: an operations ledger / syslog. Flat (no grouping), one page at a
// time, zebra-striped, mono metadata, tight vertical rhythm. Each entry is two
// rows: the incident title reads at full width on line 1, and the filterable /
// sortable metadata sits in aligned columns on line 2 under a sticky header.
// Optimised for scanning a lot of entries and acting fast.

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
  incidentDaysOpen, isStaleIncident, severityBadgeClass, severityShapeStatus,
  severityUrgencyLabel, sourceTableIcon, sourceTableLabel, statusLabel,
} from '../../libs/incidentTaxonomy';
import { useIncidentLedger } from '../../libs/useIncidentLedger';
import { LedgerPager } from './LedgerPager';
import {
  LEDGER_COLUMNS, LEDGER_GRID, LEDGER_COPY, LedgerSortHeader,
  isNewSince, type IncidentLedgerViewProps,
} from './ledgerModel';

const STATE_DOT: Record<string, string> = {
  open: 'bg-status-warning',
  acknowledged: 'bg-status-info',
  in_progress: 'bg-status-info',
  resolved: 'bg-status-success',
  dismissed: 'bg-foreground/40',
};

/** Rows that play the one-shot entrance cascade when a page lands. */
const CASCADE_ROWS = 12;

export function IncidentsLedgerView({
  incidents, focusedId, lastSeenAt, onOpenDetail,
  onAcknowledge, onResolve, onDismiss, onReopen, onPageRowsChange,
}: IncidentLedgerViewProps) {
  const ledger = useIncidentLedger(incidents, { initialSortKey: 'created', initialPageSize: 25 });
  const { page, sortKey, sortDir, toggleSort } = ledger;

  // Keyboard triage walks exactly what is on screen — this page, in sort order.
  useEffect(() => { onPageRowsChange(page); }, [page, onPageRowsChange]);

  // A new page / sort is a new reading order, so the cascade replays for it; a
  // 30s poll re-delivering the same ids does not (RevealItem is id-guarded).
  const enter = useRevealTracker(`${sortKey}|${sortDir}|${ledger.pageIndex}|${ledger.pageSize}`);

  return (
    <div className="flex flex-col">
      {/* Sticky column header — permanent chrome, identical above ghosts,
          the empty state and real rows (docs/design/overview-loading.md law 5). */}
      <div
        className="sticky top-0 z-10 grid items-center gap-2 border-y border-primary/10 bg-background/95 px-4 py-1.5 pl-6"
        style={{ gridTemplateColumns: LEDGER_GRID }}
        role="row"
      >
        {LEDGER_COLUMNS.map((col) => (
          <LedgerSortHeader
            key={col.key}
            column={col}
            sortKey={sortKey}
            sortDir={sortDir}
            onToggle={toggleSort}
            dense
          />
        ))}
      </div>

      {page.length === 0 ? (
        <p className="px-4 py-10 text-center typo-body text-foreground">{LEDGER_COPY.empty}</p>
      ) : (
        <div>
          {page.map((incident, index) => (
            <RevealItem
              key={incident.id}
              revealId={incident.id}
              order={index}
              hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)}
              markEntered={enter.markEntered}
            >
              <LedgerEntry
                incident={incident}
                zebra={index % 2 === 1}
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
        dense
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

const LedgerEntry = memo(function LedgerEntry({
  incident, zebra, focused, isNew, onOpenDetail, onAcknowledge, onResolve, onDismiss, onReopen,
}: {
  incident: AuditIncident;
  zebra: boolean;
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
  const shape = severityShapeStatus(incident.severity);
  const stale = isStaleIncident(incident);
  const days = incidentDaysOpen(incident.createdAt);
  const isOpen = incident.status === 'open';
  const isAcknowledged = incident.status === 'acknowledged';
  const isClosed = incident.status === 'resolved' || incident.status === 'dismissed';
  const accent = isClosed || shape === 'neutral'
    ? 'border-l-transparent'
    : shape === 'error' ? 'border-l-status-error/70' : 'border-l-status-warning/70';

  return (
    <div
      id={`incident-row-${incident.id}`}
      data-testid="incident-row"
      role="row"
      onClick={() => onOpenDetail(incident)}
      className={`cursor-pointer border-l-2 border-b border-b-primary/[0.06] ${accent} transition-colors ${
        focused ? 'bg-secondary/40 ring-1 ring-inset ring-primary/40' : zebra ? 'bg-primary/[0.02] hover:bg-secondary/20' : 'hover:bg-secondary/20'
      }`}
    >
      {/* Line 1 — the incident itself, full width, never squeezed by a column */}
      <div className="flex items-center gap-2 px-4 pt-2 pb-0.5">
        <StatusShape
          status={shape}
          size="sm"
          title={severityUrgencyLabel(t, incident.severity)}
          aria-label={severityUrgencyLabel(t, incident.severity)}
        />
        <span className="typo-body text-foreground">{incident.title}</span>
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

      {/* Line 2 — metadata, aligned to the header's columns */}
      <div
        className="grid items-center gap-2 px-4 pb-1.5 pl-6"
        style={{ gridTemplateColumns: LEDGER_GRID }}
      >
        <span className={`inline-flex w-fit items-center rounded-card border px-1.5 py-0.5 typo-caption font-mono uppercase tracking-wider ${severityBadgeClass(incident.severity)}`}>
          {tokenLabel(t, 'severity', incident.severity)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 typo-caption font-mono text-foreground">
          <SourceIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{sourceTableLabel(t, incident.sourceTable)}</span>
        </span>
        <span className="truncate typo-caption font-mono text-foreground">{incident.personaName ?? '—'}</span>
        <span className="flex min-w-0 items-center gap-1.5 typo-caption font-mono text-foreground">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[incident.status] ?? 'bg-foreground/40'}`} aria-hidden="true" />
          <span className="truncate">{statusLabel(t, incident.status)}</span>
        </span>
        <span className={`text-right typo-caption font-mono tabular-nums ${stale ? 'text-status-warning' : 'text-foreground'}`}>
          {days < 1 ? '<1d' : `${days}d`}
        </span>
        <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {isOpen && <LedgerAction icon={Check} label={t.overview.incidents.action_acknowledge} onClick={() => onAcknowledge(incident.id)} />}
          {(isOpen || isAcknowledged) && <LedgerAction icon={CheckCheck} label={t.overview.incidents.action_resolve} onClick={() => onResolve(incident.id)} />}
          {(isOpen || isAcknowledged) && <LedgerAction icon={X} label={t.overview.incidents.action_dismiss} onClick={() => onDismiss(incident.id)} />}
          {isClosed && <LedgerAction icon={RotateCcw} label={t.overview.incidents.action_reopen} onClick={() => onReopen(incident.id)} />}
        </span>
      </div>
    </div>
  );
});

function LedgerAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-card border border-primary/15 p-1 text-foreground transition-colors hover:bg-secondary/50 focus-ring"
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}
