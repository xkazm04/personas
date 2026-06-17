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
  renderRow: (incident: AuditIncident) => React.ReactNode;
}

/**
 * One collapsible section in the incidents inbox. The header carries the group
 * label (agent name, severity tier, or source kind — depending on the active
 * group-by lens), a count badge, and a colourblind-safe shape for the group's
 * worst severity. In flat ("none") mode there is no header — the rows render
 * directly.
 */
export function IncidentAgentGroup({ group, collapsed, onToggle, renderRow }: Props) {
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

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="sticky top-9 z-20 flex w-full items-center gap-2 border-b border-primary/10 bg-secondary px-4 py-2 text-left focus-ring"
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

      {!collapsed && (
        <div className="divide-y divide-primary/5">
          {group.incidents.map((incident) => renderRow(incident))}
        </div>
      )}
    </div>
  );
}
