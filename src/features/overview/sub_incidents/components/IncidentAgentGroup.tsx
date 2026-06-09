import { ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import { severityShapeStatus, severityUrgencyLabel, sourceTableLabel } from '../libs/incidentTaxonomy';
import type { IncidentGroup } from '../libs/groupIncidents';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

interface Props {
  group: IncidentGroup;
  collapsed: boolean;
  onToggle: () => void;
  /** Acknowledge every still-open incident in this group. */
  onAckAll: (ids: string[]) => void;
  /** Resolve every still-active incident in this group. */
  onResolveAll: (ids: string[]) => void;
  renderRow: (incident: AuditIncident) => React.ReactNode;
}

const ACTIVE_STATUSES = new Set(['open', 'acknowledged', 'in_progress']);

/**
 * One collapsible section in the incidents inbox. The header carries the group
 * label (agent name, severity tier, or source kind — depending on the active
 * group-by lens), a count badge, a colourblind-safe shape for the group's worst
 * severity, and one-click "acknowledge / resolve all" actions so a user can
 * clear a whole group without opening each row. In flat ("none") mode there is
 * no header — the rows render directly.
 */
export function IncidentAgentGroup({
  group,
  collapsed,
  onToggle,
  onAckAll,
  onResolveAll,
  renderRow,
}: Props) {
  const { t } = useTranslation();

  // Flat mode has a single group with no meaningful header — render rows directly.
  if (group.mode === 'none') {
    return (
      <div className="divide-y divide-primary/5">
        {group.incidents.map((incident) => renderRow(incident))}
      </div>
    );
  }

  // The header label depends on which dimension we're grouped by.
  const name =
    group.mode === 'severity'
      ? tokenLabel(t, 'severity', group.labelToken ?? group.worstSeverity)
      : group.mode === 'source'
        ? sourceTableLabel(t, group.labelToken ?? '')
        : (group.personaName ?? t.overview.incidents.group_no_persona);
  const urgency = severityUrgencyLabel(t, group.worstSeverity);

  const ackableIds = group.incidents.filter((i) => i.status === 'open').map((i) => i.id);
  const resolvableIds = group.incidents
    .filter((i) => ACTIVE_STATUSES.has(i.status))
    .map((i) => i.id);

  return (
    <div>
      <div className="sticky top-0 z-20 flex w-full items-center gap-2 border-b border-primary/10 bg-secondary px-4 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-ring"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`}
            aria-hidden="true"
          />
          <StatusShape
            status={severityShapeStatus(group.worstSeverity)}
            size="sm"
            title={urgency}
            aria-label={urgency}
          />
          <span className="typo-body font-medium text-foreground truncate">{name}</span>
          <span className="ml-auto typo-caption text-foreground rounded-card border border-primary/15 px-1.5 py-0.5">
            {group.count}
          </span>
        </button>

        {ackableIds.length > 0 && (
          <button
            type="button"
            onClick={() => onAckAll(ackableIds)}
            className="shrink-0 px-2 py-0.5 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/40 transition-colors focus-ring"
          >
            {t.overview.incidents.bulk_acknowledge_count.replace('{count}', String(ackableIds.length))}
          </button>
        )}
        {resolvableIds.length > 0 && (
          <button
            type="button"
            onClick={() => onResolveAll(resolvableIds)}
            className="shrink-0 px-2 py-0.5 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/40 transition-colors focus-ring"
          >
            {t.overview.incidents.bulk_resolve_count.replace('{count}', String(resolvableIds.length))}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="divide-y divide-primary/5">
          {group.incidents.map((incident) => renderRow(incident))}
        </div>
      )}
    </div>
  );
}
