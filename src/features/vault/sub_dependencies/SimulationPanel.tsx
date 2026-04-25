import { FlaskConical, X } from 'lucide-react';
import type { SimulationResult } from './credentialGraph';
import { getSeverityStyles } from './graphConstants';
import { useTranslation } from '@/i18n/useTranslation';
import { escapeHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
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
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  const sev = getSeverityStyles(t)[simulation.severity];

  const workflowPlural = simulation.totalAffectedWorkflows !== 1 ? 's' : '';
  const personaPlural = simulation.totalAffectedPersonas !== 1 ? 's' : '';
  const safeCredentialName = escapeHtml(simulation.credentialName);

  return (
    <div className="animate-fade-slide-in rounded-modal border border-primary/15 bg-secondary/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-fuchsia-400/80" />
          <span className="typo-body font-medium text-foreground/85">{dep.revocation_simulation}</span>
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-input border ${sev.bg} ${sev.text} ${sev.border}`}>
            {sev.label}
          </span>
        </div>
        <button type="button" onClick={onClose} className="p-1 hover:bg-secondary/50 rounded transition-colors cursor-pointer">
          <X className="w-3.5 h-3.5 text-foreground" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Impact Summary Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-card bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="typo-heading-lg font-semibold text-foreground/90">{simulation.totalAffectedPersonas}</div>
            <div className="text-[10px] text-foreground">{dep.personas_affected}</div>
          </div>
          <div className="rounded-card bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="typo-heading-lg font-semibold text-foreground/90">{simulation.totalAffectedWorkflows}</div>
            <div className="text-[10px] text-foreground">{dep.workflows_broken}</div>
          </div>
          <div className="rounded-card bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="typo-heading-lg font-semibold text-foreground/90">{simulation.estimatedDailyExecutionsLost}</div>
            <div className="text-[10px] text-foreground">{dep.daily_execs_lost}</div>
          </div>
          <div className="rounded-card bg-secondary/40 border border-primary/8 p-2 text-center">
            <div className="typo-heading-lg font-semibold text-foreground/90">
              ${simulation.estimatedDailyRevenueLost.toFixed(2)}
            </div>
            <div className="text-[10px] text-foreground">{dep.daily_cost_impact}</div>
          </div>
        </div>

        {/* Scenario description */}
        <div className="typo-caption text-foreground leading-relaxed px-1">
          {simulation.severity === 'critical' ? (
            <span
              dangerouslySetInnerHTML={{
                __html: tx(dep.sim_critical, {
                  credentialName: `<strong class="text-fuchsia-400">${safeCredentialName}</strong>`,
                  workflows: `<strong class="text-red-400">${simulation.totalAffectedWorkflows}</strong>`,
                  workflowPlural,
                  personas: simulation.totalAffectedPersonas,
                  personaPlural,
                }),
              }}
            />
          ) : simulation.severity === 'high' ? (
            <span
              dangerouslySetInnerHTML={{
                __html: tx(dep.sim_high, {
                  credentialName: `<strong class="text-red-400">${safeCredentialName}</strong>`,
                  personas: simulation.totalAffectedPersonas,
                  personaPlural,
                }),
              }}
            />
          ) : simulation.severity === 'medium' ? (
            <span
              dangerouslySetInnerHTML={{
                __html: tx(dep.sim_medium, {
                  credentialName: `<strong class="text-amber-400">${safeCredentialName}</strong>`,
                }),
              }}
            />
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
