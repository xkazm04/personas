import { ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import { severityShapeStatus, severityUrgencyLabel } from '../libs/incidentTaxonomy';
import type { IncidentGroup } from '../libs/groupIncidents';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

interface Props {
  group: IncidentGroup;
  collapsed: boolean;
  onToggle: () => void;
  renderRow: (incident: AuditIncident) => React.ReactNode;
}

/**
 * One collapsible per-agent section in the incidents inbox. The header carries
 * the agent name, a count badge, and a colourblind-safe shape for the group's
 * worst severity so a user can spot the agent that needs attention without
 * expanding anything.
 */
export function IncidentAgentGroup({ group, collapsed, onToggle, renderRow }: Props) {
  const { t } = useTranslation();
  const name = group.personaName ?? t.overview.incidents.group_no_persona;
  const urgency = severityUrgencyLabel(t, group.worstSeverity);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 border-b border-primary/10 bg-secondary/20 px-4 py-2 hover:bg-secondary/30 transition-colors focus-ring"
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
