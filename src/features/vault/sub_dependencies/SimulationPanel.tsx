import { FlaskConical, X } from 'lucide-react';
import type { SimulationResult } from './credentialGraph';
import { getSeverityStyles } from './graphConstants';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { escapeHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import {
  AffectedPersonas,
  FailoverSuggestions,
  MitigationSummary,
} from './SimulationControls';
import Button from '@/features/shared/components/buttons/Button';

interface SimulationPanelProps {
  simulation: SimulationResult;
  onClose: () => void;
}

export function SimulationPanel({ simulation, onClose }: SimulationPanelProps) {
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  const sev = getSeverityStyles(t)[simulation.severity];

  const personaPlural = simulation.totalAffectedPersonas !== 1 ? 's' : '';
  const safeCredentialName = escapeHtml(simulation.credentialName);

  return (
    <div className="animate-fade-slide-in rounded-modal border border-hair bg-surface-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-hair">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-role-agent/80" />
          <span className="typo-body text-ink-1">{dep.revocation_simulation}</span>
          <span className={`px-1.5 py-0.5 typo-label rounded-input border ${sev.bg} ${sev.text} ${sev.border}`}>
            {sev.label}
          </span>
        </div>
        <Button type="button" onClick={onClose} variant="ghost" size="icon-sm">
          <X className="w-3.5 h-3.5 text-foreground" />
        </Button>
      </div>

      <div className="p-3 space-y-3">
        {/* Impact Summary Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-card bg-surface-2 border border-primary/8 p-2 text-center">
            <div className="typo-heading-lg text-ink-1">{simulation.totalAffectedPersonas}</div>
            <div className="typo-caption text-foreground">{dep.personas_affected}</div>
          </div>
          <div className="rounded-card bg-surface-2 border border-primary/8 p-2 text-center">
            <div className="typo-heading-lg text-ink-1">{simulation.estimatedDailyExecutionsLost}</div>
            <div className="typo-caption text-foreground">{dep.daily_execs_lost}</div>
          </div>
          <div className="rounded-card bg-surface-2 border border-primary/8 p-2 text-center">
            <Numeric
              as="div"
              value={simulation.estimatedDailyRevenueLost}
              unit="usd"
              className="typo-heading-lg text-ink-1"
            />
            <div className="typo-caption text-foreground">{dep.daily_cost_impact}</div>
          </div>
        </div>

        {/* Scenario description */}
        <div className="typo-caption text-foreground px-1">
          {simulation.severity === 'high' ? (
            <span
              dangerouslySetInnerHTML={{
                __html: tx(dep.sim_high, {
                  credentialName: `<strong class="text-status-error">${safeCredentialName}</strong>`,
                  personas: simulation.totalAffectedPersonas,
                  personaPlural,
                }),
              }}
            />
          ) : simulation.severity === 'medium' ? (
            <span
              dangerouslySetInnerHTML={{
                __html: tx(dep.sim_medium, {
                  credentialName: `<strong class="text-status-warning">${safeCredentialName}</strong>`,
                }),
              }}
            />
          ) : (
            <span>{dep.sim_low}</span>
          )}
        </div>

        <AffectedPersonas personas={simulation.affectedPersonas} />
        <FailoverSuggestions suggestions={simulation.failoverSuggestions} />
        <MitigationSummary simulation={simulation} />
      </div>
    </div>
  );
}
