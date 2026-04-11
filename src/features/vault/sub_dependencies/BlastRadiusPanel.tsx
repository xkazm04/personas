import { Key, Bot, Zap, X, Shield, FlaskConical } from 'lucide-react';
import type { BlastRadius } from './credentialGraph';
import type { SimulationResult } from './credentialGraph';
import { getSeverityStyles } from './graphConstants';
import { useTranslation } from '@/i18n/useTranslation';
import { SimulationPanel } from './SimulationPanel';

interface BlastRadiusPanelProps {
  blast: BlastRadius;
  onClose: () => void;
  simulation?: SimulationResult | null;
  simulationMode?: boolean;
  onToggleSimulation?: () => void;
}

export function BlastRadiusPanel({
  blast,
  onClose,
  simulation,
  simulationMode,
  onToggleSimulation,
}: BlastRadiusPanelProps) {
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  const sev = getSeverityStyles(t)[blast.severity];

  return (
    <div className="space-y-2">
      {/* Simulation toggle (only shown when handler provided) */}
      {onToggleSimulation && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-primary/10 bg-secondary/20">
          <div className="flex items-center gap-2">
            <FlaskConical className={`w-3.5 h-3.5 ${simulationMode ? 'text-fuchsia-400' : 'text-muted-foreground/50'}`} />
            <span className="text-xs text-muted-foreground/70">{dep.simulate_revocation}</span>
          </div>
          <button
            type="button"
            onClick={onToggleSimulation}
            className={`relative w-8 h-4.5 rounded-full transition-colors cursor-pointer ${
              simulationMode ? 'bg-fuchsia-500/40' : 'bg-secondary/60 border border-primary/15'
            }`}
            aria-label={simulationMode ? 'Disable simulation mode' : 'Enable simulation mode'}
            role="switch"
            aria-checked={simulationMode}
          >
            <span
              className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${
                simulationMode ? 'left-4 bg-fuchsia-400' : 'left-0.5 bg-muted-foreground/40'
              }`}
            />
          </button>
        </div>
      )}

      {simulationMode && simulation ? (
          <SimulationPanel
            key="simulation"
            simulation={simulation}
            onClose={onClose}
          />
        ) : (
          <div
            key="blast"
            className="animate-fade-slide-in rounded-xl border border-primary/15 bg-secondary/30 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground/60" />
                <span className="text-sm font-medium text-foreground/85">{dep.blast_radius}</span>
              </div>
              <button type="button" onClick={onClose} className="p-1 hover:bg-secondary/50 rounded transition-colors cursor-pointer">
                <X className="w-3.5 h-3.5 text-muted-foreground/50" />
              </button>
            </div>

            <div className="p-3 space-y-3">
              {/* Credential name + severity */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-muted-foreground/60" />
                  <span className="text-sm font-medium text-foreground/80">{blast.credentialName}</span>
                </div>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-lg border ${sev.bg} ${sev.text} ${sev.border}`}>
                  {sev.label}
                </span>
              </div>

              {/* Impact summary */}
              <div className="text-xs text-muted-foreground/70 leading-relaxed">
                {blast.severity === 'high' ? (
                  <span>{tx(dep.impact_high, { count: blast.affectedAgents.length })}</span>
                ) : blast.severity === 'medium' ? (
                  <span>{tx(dep.impact_medium, { count: blast.affectedAgents.length })}</span>
                ) : (
                  <span>{dep.impact_low}</span>
                )}
              </div>

              {/* Affected agents */}
              {blast.affectedAgents.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground/60 mb-1.5">{dep.affected_agents}</div>
                  <div className="space-y-1">
                    {blast.affectedAgents.map((agent) => (
                      <div key={agent.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/30 border border-primary/8">
                        <Bot className="w-3 h-3 text-blue-400/60" />
                        <span className="text-xs text-foreground/80 flex-1 truncate">{agent.name}</span>
                        {agent.via && (
                          <span className="text-xs text-muted-foreground/60 font-mono">{agent.via}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Affected events */}
              {blast.affectedEvents.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground/60 mb-1.5">{dep.affected_events}</div>
                  <div className="space-y-1">
                    {blast.affectedEvents.map((evt) => (
                      <div key={evt.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/30 border border-primary/8">
                        <Zap className="w-3 h-3 text-amber-400/60" />
                        <span className="text-xs text-foreground/80 truncate">{evt.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
