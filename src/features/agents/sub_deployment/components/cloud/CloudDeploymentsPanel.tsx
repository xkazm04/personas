import { useTranslation } from '@/i18n/useTranslation';
import { useState } from 'react';
import { Rocket, RefreshCw } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { usePersonaNameMap } from "@/hooks/usePersonaNameMap";
import { Button } from '@/features/shared/components/buttons';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import type { CloudDeployment } from '@/api/system/cloud';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { BUDGET_PRESETS } from './cloudDeploymentHelpers';
import { DeploymentCard } from './DeploymentCard';
import { useDeploymentTest } from '../../hooks/useDeploymentTest';
import { silentCatch } from '@/lib/silentCatch';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { RevealItem } from '@/features/shared/components/display/RevealItem';


// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  deployments: CloudDeployment[];
  baseUrl: string | null;
  isDeploying: boolean;
  /** True while the deployments list is being (re)fetched. Never hides rows
   * already on screen — only gates the empty state vs. ghost placeholders. */
  isFetching?: boolean;
  onDeploy: (personaId: string, maxMonthlyBudgetUsd?: number) => Promise<CloudDeployment>;
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const DEPLOYMENT_CASCADE_ROWS = 14;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CloudDeploymentsPanel({
  deployments,
  baseUrl,
  isDeploying,
  isFetching = false,
  onDeploy,
  onPause,
  onResume,
  onRemove,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const dt = t.deployment.deployments_panel;
  const personas = useAgentStore((s) => s.personas);
  const personaName = usePersonaNameMap();
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedBudget, setSelectedBudget] = useState<number | undefined>(10);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { tests, runTest, dismissResult } = useDeploymentTest();
  const enter = useRevealTracker('cloud-deployments');
  const showGhost = isFetching && deployments.length === 0;

  // Which personas are not yet deployed?
  const deployedPersonaIds = new Set(deployments.map((d) => d.personaId));
  const deployablePersonas = personas.filter((p) => !deployedPersonaIds.has(p.id));

  const handleDeploy = async () => {
    if (!selectedPersonaId) return;
    try {
      await onDeploy(selectedPersonaId, selectedBudget);
      setSelectedPersonaId('');
    } catch (err) { silentCatch("features/deployment/components/cloud/CloudDeploymentsPanel:catch1")(err); }
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
          <SectionHeading className={DEPLOYMENT_TOKENS.sectionHeadingGap}>{dt.deploy_persona}</SectionHeading>
          <Button
            variant="secondary"
            size="xs"
            icon={<RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />}
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {t.common.refresh}
          </Button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="deploy-persona-select" className="typo-body font-medium text-foreground">
              Persona
            </label>
            <select
              id="deploy-persona-select"
              value={selectedPersonaId}
              onChange={(e) => setSelectedPersonaId(e.target.value)}
              disabled={isDeploying || deployablePersonas.length === 0}
              className="w-full px-3 py-2 typo-body rounded-modal
                         bg-secondary/40 border border-primary/15
                         text-foreground placeholder:text-muted-foreground
                         focus-visible:outline-none focus-visible:border-indigo-500/40
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors"
            >
              <option value="">
                {deployablePersonas.length === 0 ? dt.all_deployed : dt.select_persona}
              </option>
              {deployablePersonas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="deploy-budget-select" className="typo-body font-medium text-foreground">
              Budget
            </label>
            <select
              id="deploy-budget-select"
              value={selectedBudget ?? ''}
              onChange={(e) => setSelectedBudget(e.target.value ? Number(e.target.value) : undefined)}
              disabled={isDeploying}
              className="w-full px-3 py-2 typo-body rounded-modal
                         bg-secondary/40 border border-primary/15
                         text-foreground
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
            {isDeploying ? t.deployment.deploying : 'Deploy'}
          </Button>
        </div>
      </div>

      {/* Deployment list — ghost cards only into cold emptiness while a
          fetch runs; settled-only empty state (docs/design/overview-loading.md). */}
      {showGhost ? (
        <div className="space-y-3">
          <DeploymentCardGhosts />
        </div>
      ) : deployments.length === 0 ? (
        <p className="typo-body text-foreground py-8 text-center">
          {t.deployment.deployments_panel.no_deployments_yet}
        </p>
      ) : (
        <div className="space-y-3">
          <SectionHeading className={DEPLOYMENT_TOKENS.sectionHeadingGap}>{t.deployment.deployments_panel.active_deployments} ({deployments.length})</SectionHeading>

          {deployments.map((d, index) => (
            // One-shot entrance cascade; rows past the first viewport render
            // plainly (folded into hasEntered); entered ids never replay.
            <RevealItem
              key={d.id}
              revealId={d.id}
              order={index}
              hasEntered={(id) => index >= DEPLOYMENT_CASCADE_ROWS || enter.hasEntered(id)}
              markEntered={enter.markEntered}
            >
              <DeploymentCard
                deployment={d}
                baseUrl={baseUrl}
                personaName={personaName(d.personaId)}
                onPause={onPause}
                onResume={onResume}
                onRemove={onRemove}
                testRunning={tests[d.id]?.running}
                testResult={tests[d.id]?.result}
                onTest={runTest}
                onDismissTest={dismissResult}
              />
            </RevealItem>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeploymentCardGhosts — calm placeholder cards for the ONLY moment the
// deployments list has nothing to show (a fetch with a cold list). Same
// card radius/padding as `DeploymentCard` so the swap to real cards moves
// nothing. Delayed entrance (§C, docs/design/overview-loading.md) — a fetch
// that resolves quickly never paints a single ghost. No `animate-pulse`.
// ---------------------------------------------------------------------------

function DeploymentCardGhosts() {
  return (
    <div aria-hidden="true" className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className={`p-3 ${DEPLOYMENT_TOKENS.cardRadius} bg-secondary/30 border border-primary/10 space-y-2 animate-fade-in`}
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="flex items-center justify-between">
            <span className="h-3.5 w-32 rounded bg-primary/[0.06]" />
            <span className="h-5 w-16 rounded-card bg-primary/[0.06]" />
          </div>
          <span className="block h-6 w-full rounded-card bg-primary/[0.06]" />
          <span className="block h-3 w-48 rounded bg-primary/[0.06]" />
        </div>
      ))}
    </div>
  );
}
