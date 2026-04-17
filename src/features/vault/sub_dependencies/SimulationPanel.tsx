import { FlaskConical, X } from 'lucide-react';
import type { SimulationResult } from './credentialGraph';
import { getSeverityStyles } from './graphConstants';
import { useTranslation } from '@/i18n/useTranslation';
import {
  AffectedPersonas,
  AffectedWorkflows,
  FailoverSuggestions,
  MitigationSummary,
} from './SimulationControls';

interface SimulationPanelProps {
  simulation: SimulationResult;
  onClose: () => void;
}

export function SimulationPanel({ simulation, onClose }: SimulationPanelProps) {
  const { t } = useTranslation();
  const dep = t.vault.dependencies;
  const sev = getSeverityStyles(t)[simulation.severity];

  return (
    <div className="animate-fade-slide-in rounded-modal border border-primary/15 bg-secondary/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-fuchsia-400/80" />
          <span className="text-sm font-medium text-foreground/85">{dep.revocation_simulation}</span>
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-input border ${sev.bg} ${sev.text} ${sev.border}`}>
            {sev.label}
          </span>
        </div>
        <button type="button" onClick={onClose} className="p-1 hover:bg-secondary/50 rounded transition-colors cursor-pointer">
          <X className="w-3.5 h-3.5 text-muted-foreground/50" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Impact Summary Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-card bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="text-lg font-semibold text-foreground/90">{simulation.totalAffectedPersonas}</div>
            <div className="text-[10px] text-muted-foreground/60">{dep.personas_affected}</div>
          </div>
          <div className="rounded-card bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="text-lg font-semibold text-foreground/90">{simulation.totalAffectedWorkflows}</div>
            <div className="text-[10px] text-muted-foreground/60">{dep.workflows_broken}</div>
          </div>
          <div className="rounded-card bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="text-lg font-semibold text-foreground/90">{simulation.estimatedDailyExecutionsLost}</div>
            <div className="text-[10px] text-muted-foreground/60">{dep.daily_execs_lost}</div>
          </div>
          <div className="rounded-card bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="text-lg font-semibold text-foreground/90">
              ${simulation.estimatedDailyRevenueLost.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground/60">{dep.daily_cost_impact}</div>
          </div>
        </div>

        {/* Scenario description */}
        <div className="text-xs text-muted-foreground/70 leading-relaxed px-1">
          {simulation.severity === 'critical' ? (
            <span>
              Revoking <strong className="text-fuchsia-400">{simulation.credentialName}</strong> would break{' '}
              <strong className="text-red-400">{simulation.totalAffectedWorkflows} workflow{simulation.totalAffectedWorkflows !== 1 ? 's' : ''}</strong>{' '}
              and halt {simulation.totalAffectedPersonas} persona{simulation.totalAffectedPersonas !== 1 ? 's' : ''}.
            </span>
          ) : simulation.severity === 'high' ? (
            <span>
              Revoking <strong className="text-red-400">{simulation.credentialName}</strong> would impact{' '}
              {simulation.totalAffectedPersonas} persona{simulation.totalAffectedPersonas !== 1 ? 's' : ''} across your workspace.
            </span>
          ) : simulation.severity === 'medium' ? (
            <span>
              Revoking <strong className="text-amber-400">{simulation.credentialName}</strong> has limited blast radius.
            </span>
          ) : (
            <span>{dep.sim_low}</span>
          )}
        </div>

        <AffectedPersonas personas={simulation.affectedPersonas} />
        <AffectedWorkflows workflows={simulation.affectedWorkflows} />
        <FailoverSuggestions suggestions={simulation.failoverSuggestions} />
        <MitigationSummary simulation={simulation} />
      </div>
    </div>
  );
}
