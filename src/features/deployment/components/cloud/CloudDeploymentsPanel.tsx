import { useState } from 'react';
import { Rocket, RefreshCw } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { Button } from '@/features/shared/components/buttons';
import type { CloudDeployment } from '@/api/system/cloud';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { BUDGET_PRESETS } from './cloudDeploymentHelpers';
import { DeploymentCard } from './DeploymentCard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  deployments: CloudDeployment[];
  baseUrl: string | null;
  isDeploying: boolean;
  onDeploy: (personaId: string, maxMonthlyBudgetUsd?: number) => Promise<CloudDeployment>;
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CloudDeploymentsPanel({
  deployments,
  baseUrl,
  isDeploying,
  onDeploy,
  onPause,
  onResume,
  onRemove,
  onRefresh,
}: Props) {
  const personas = useAgentStore((s) => s.personas);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedBudget, setSelectedBudget] = useState<number | undefined>(10);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const personaName = (id: string) =>
    personas.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  // Which personas are not yet deployed?
  const deployedPersonaIds = new Set(deployments.map((d) => d.persona_id));
  const deployablePersonas = personas.filter((p) => !deployedPersonaIds.has(p.id));

  const handleDeploy = async () => {
    if (!selectedPersonaId) return;
    try {
      await onDeploy(selectedPersonaId, selectedBudget);
      setSelectedPersonaId('');
    } catch {
      // error handled by store
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try { await onRefresh(); } finally { setIsRefreshing(false); }
  };

  return (
    <div className={DEPLOYMENT_TOKENS.panelSpacing}>
      {/* Deploy new persona */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className={`text-sm font-medium text-muted-foreground/90 uppercase tracking-wider ${DEPLOYMENT_TOKENS.sectionHeadingGap}`}>
            Deploy Persona
          </h3>
          <Button
            variant="secondary"
            size="xs"
            icon={<RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />}
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            Refresh
          </Button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="deploy-persona-select" className="text-sm font-medium text-muted-foreground/80">
              Persona
            </label>
            <select
              id="deploy-persona-select"
              value={selectedPersonaId}
              onChange={(e) => setSelectedPersonaId(e.target.value)}
              disabled={isDeploying || deployablePersonas.length === 0}
              className="w-full px-3 py-2 text-sm rounded-xl
                         bg-secondary/40 border border-primary/15
                         text-foreground/80 placeholder:text-muted-foreground/80
                         focus-visible:outline-none focus-visible:border-indigo-500/40
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors"
            >
              <option value="">
                {deployablePersonas.length === 0 ? 'All personas deployed' : 'Select a persona\u2026'}
              </option>
              {deployablePersonas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="deploy-budget-select" className="text-sm font-medium text-muted-foreground/80">
              Budget
            </label>
            <select
              id="deploy-budget-select"
              value={selectedBudget ?? ''}
              onChange={(e) => setSelectedBudget(e.target.value ? Number(e.target.value) : undefined)}
              disabled={isDeploying}
              className="w-full px-3 py-2 text-sm rounded-xl
                         bg-secondary/40 border border-primary/15
                         text-foreground/80
                         focus-visible:outline-none focus-visible:border-indigo-500/40
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors"
            >
              {BUDGET_PRESETS.map((b) => (
                <option key={b.label} value={b.value ?? ''}>{b.label}</option>
              ))}
            </select>
          </div>

          <Button
            variant="primary"
            size="sm"
            icon={isDeploying ? undefined : <Rocket className="w-4 h-4" />}
            loading={isDeploying}
            onClick={handleDeploy}
            disabled={!selectedPersonaId || isDeploying}
            accentColor="indigo"
          >
            {isDeploying ? 'Deploying\u2026' : 'Deploy'}
          </Button>
        </div>
      </div>

      {/* Deployment list */}
      {deployments.length === 0 ? (
        <p className="text-sm text-muted-foreground/90 py-8 text-center">
          No deployments yet. Select a persona above to deploy it as a cloud API endpoint.
        </p>
      ) : (
        <div className="space-y-3">
          <h3 className={`text-sm font-medium text-muted-foreground/90 uppercase tracking-wider ${DEPLOYMENT_TOKENS.sectionHeadingGap}`}>
            Active Deployments ({deployments.length})
          </h3>

          {deployments.map((d) => (
            <DeploymentCard
              key={d.id}
              deployment={d}
              baseUrl={baseUrl}
              personaName={personaName(d.persona_id)}
              onPause={onPause}
              onResume={onResume}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
