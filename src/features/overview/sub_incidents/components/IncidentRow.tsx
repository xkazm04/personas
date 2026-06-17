import type { LucideIcon } from 'lucide-react';
import { Check, CheckCheck, X, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import {
  isStaleIncident,
  severityBadgeClass,
  severityShapeStatus,
  severityUrgencyLabel,
  sourceTableIcon,
  sourceTableLabel,
  statusLabel,
  incidentDaysOpen,
} from '../libs/incidentTaxonomy';

interface Props {
  incident: AuditIncident;
  /** Shared grid-template so the row's columns line up with the header. */
  gridTemplate: string;
  /** Keyboard-triage focus — renders a focus ring and is the j/k cursor. */
  focused?: boolean;
  onAcknowledge: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onOpenDetail: () => void;
}

// Colour-blind users still get the StatusShape + gutter accent for severity;
// the State dot is a secondary, status-only cue.
const STATE_DOT: Record<string, string> = {
  open: 'bg-amber-400',
  acknowledged: 'bg-blue-400',
  in_progress: 'bg-blue-400',
  resolved: 'bg-emerald-400',
  dismissed: 'bg-slate-500',
};

/**
 * One incident as a single, scannable table row. Severity is shown by the left
 * gutter accent + the shape/colored source glyph in the Incident cell (no text
 * priority tag); Persona / State / Days / Actions each get their own column so
 * they align and can be filtered/sorted from the header.
 */
export function IncidentRow({
  incident,
  gridTemplate,
  focused = false,
  onAcknowledge,
  onResolve,
  onDismiss,
  onReopen,
  onOpenDetail,
}: Props) {
  const { t } = useTranslation();
  const SourceIcon = sourceTableIcon(incident.sourceTable);
  const isOpen = incident.status === 'open';
  const isAcknowledged = incident.status === 'acknowledged';
  const isClosed = incident.status === 'resolved' || incident.status === 'dismissed';

  const shape = severityShapeStatus(incident.severity);
  const stale = isStaleIncident(incident);
  const accent = isClosed || shape === 'neutral'
    ? 'border-l-transparent'
    : shape === 'error'
      ? 'border-l-red-400/70'
      : 'border-l-amber-400/70';
  const urgency = severityUrgencyLabel(t, incident.severity);
  const days = incidentDaysOpen(incident.createdAt);

  return (
    <div
      id={`incident-row-${incident.id}`}
      data-testid="incident-row"
      role="row"
      onClick={onOpenDetail}
      style={{ gridTemplateColumns: gridTemplate }}
      className={`grid items-center border-l-2 ${accent} cursor-pointer transition-colors ${
        focused ? 'bg-secondary/30 ring-1 ring-inset ring-primary/40' : 'hover:bg-secondary/20'
      }`}
    >
      {/* Incident — severity shape + source glyph + title */}
      <div className="flex items-center gap-2 px-4 py-2.5 min-w-0">
        <StatusShape status={shape} size="sm" title={urgency} aria-label={urgency} />
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-card border ${severityBadgeClass(incident.severity)}`}
          title={sourceTableLabel(t, incident.sourceTable)}
          aria-label={sourceTableLabel(t, incident.sourceTable)}
        >
          <SourceIcon className="h-3.5 w-3.5" />
        </span>
        <span className="typo-body text-foreground font-medium truncate">{incident.title}</span>
        {stale && (
          <span className="shrink-0 typo-caption px-1.5 py-0.5 rounded-card border border-amber-500/30 text-amber-400">
            {t.overview.incidents.stale_label}
          </span>
        )}
      </div>

      {/* Persona */}
      <div className="px-4 min-w-0">
        <span className="typo-body text-foreground truncate block">{incident.personaName ?? '—'}</span>
      </div>

      {/* State */}
      <div className="px-4 min-w-0">
        <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[incident.status] ?? 'bg-slate-500'}`} aria-hidden="true" />
          <span className="truncate">{statusLabel(t, incident.status)}</span>
        </span>
      </div>

      {/* Days open */}
      <div className="px-4 text-right">
        <span className={`typo-code ${stale ? 'text-amber-400' : 'text-foreground'}`}>
          {days < 1 ? '<1d' : `${days}d`}
        </span>
      </div>

      {/* Actions — clicks here must not open the detail modal */}
      <div className="flex shrink-0 items-center justify-end gap-1 px-4" onClick={(e) => e.stopPropagation()}>
        {isOpen && <IconAction icon={Check} label={t.overview.incidents.action_acknowledge} onClick={onAcknowledge} />}
        {(isOpen || isAcknowledged) && <IconAction icon={CheckCheck} label={t.overview.incidents.action_resolve} onClick={onResolve} />}
        {(isOpen || isAcknowledged) && <IconAction icon={X} label={t.overview.incidents.action_dismiss} onClick={onDismiss} />}
        {isClosed && <IconAction icon={RotateCcw} label={t.overview.incidents.action_reopen} onClick={onReopen} />}
      </div>
    </div>
  );
}

function IconAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-card border border-primary/15 text-foreground hover:bg-secondary/50 transition-colors focus-ring"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
