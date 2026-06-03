import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import {
  severityBadgeClass,
  severityRank,
  severityShapeStatus,
  severityUrgencyLabel,
  sourceTableIcon,
  sourceTableLabel,
  relativeTime,
  statusLabel,
} from '../libs/incidentTaxonomy';
import { incidentRowSubtext } from '../libs/incidentDetail';

interface Props {
  incident: AuditIncident;
  selected: boolean;
  onSelectChange: (selected: boolean) => void;
  onAcknowledge: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onOpenDetail: () => void;
}

export function IncidentRow({
  incident,
  selected,
  onSelectChange,
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

  // Severity gutter-accent, matching the overview tables: critical/high read
  // red, medium reads amber, and closed incidents are muted to neutral so the
  // open work stands out.
  const rank = severityRank(incident.severity);
  // Human-readable inline subtext: prose detail shows, structured (JSON /
  // key=value) payloads are suppressed here and broken down in the detail modal.
  const subtext = incidentRowSubtext(incident.detail);
  const accent = isClosed
    ? 'border-l-transparent'
    : rank >= 3
      ? 'border-l-red-400/70'
      : rank === 2
        ? 'border-l-amber-400/70'
        : 'border-l-transparent';

  return (
    <div className={`flex items-start gap-3 border-l-2 ${accent} px-4 py-3 hover:bg-secondary/20 transition-colors`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onSelectChange(e.target.checked)}
        aria-label={`select-${incident.id}`}
        className="mt-1.5 h-4 w-4 rounded-input border-primary/20"
      />

      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card border ${severityBadgeClass(incident.severity)}`}>
        <SourceIcon className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <StatusShape
              status={severityShapeStatus(incident.severity)}
              size="sm"
              title={severityUrgencyLabel(t, incident.severity)}
              aria-label={severityUrgencyLabel(t, incident.severity)}
            />
            <span className={`typo-caption px-1.5 py-0.5 rounded-card border ${severityBadgeClass(incident.severity)}`}>
              {tokenLabel(t, 'severity', incident.severity)}
            </span>
          </span>
          <span className="typo-body text-foreground font-medium truncate">{incident.title}</span>
          {!isOpen && (
            <span className="typo-caption text-foreground">· {statusLabel(t, incident.status)}</span>
          )}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 typo-caption text-foreground">
          {incident.personaName && <span>{incident.personaName}</span>}
          <span>·</span>
          <span>{sourceTableLabel(t, incident.sourceTable)}</span>
          <span>·</span>
          <span>{relativeTime(t, incident.createdAt)}</span>
          {incident.resolvedAt && (
            <>
              <span>·</span>
              <span>
                {t.overview.incidents.resolved_at_label} {relativeTime(t, incident.resolvedAt)}
              </span>
            </>
          )}
        </div>

        {subtext && (
          <p className="mt-1 typo-caption text-foreground line-clamp-1">{subtext}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ActionButton onClick={onOpenDetail}>{t.overview.incidents.action_open_detail}</ActionButton>
        {isOpen && (
          <>
            <ActionButton onClick={onAcknowledge}>{t.overview.incidents.action_acknowledge}</ActionButton>
            <ActionButton onClick={onResolve}>{t.overview.incidents.action_resolve}</ActionButton>
            <ActionButton onClick={onDismiss}>{t.overview.incidents.action_dismiss}</ActionButton>
          </>
        )}
        {isAcknowledged && (
          <>
            <ActionButton onClick={onResolve}>{t.overview.incidents.action_resolve}</ActionButton>
            <ActionButton onClick={onDismiss}>{t.overview.incidents.action_dismiss}</ActionButton>
          </>
        )}
        {isClosed && (
          <ActionButton onClick={onReopen}>{t.overview.incidents.action_reopen}</ActionButton>
        )}
      </div>
    </div>
  );
}

function ActionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/40 transition-colors focus-ring"
    >
      {children}
    </button>
  );
}
