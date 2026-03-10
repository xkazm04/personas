import { useState } from 'react';
import { Rocket, Loader2, RefreshCw, Pause, Play, Trash2, Copy, ExternalLink, Check, DollarSign } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { CloudDeployment } from '@/api/system/cloud';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';

const BUDGET_PRESETS = [
  { label: 'No limit', value: undefined },
  { label: '$5/mo', value: 5 },
  { label: '$10/mo', value: 10 },
  { label: '$25/mo', value: 25 },
  { label: '$50/mo', value: 50 },
  { label: '$100/mo', value: 100 },
] as const;

function budgetUtilization(d: CloudDeployment): number | null {
  if (!d.max_monthly_budget_usd || !d.current_month_cost_usd) return null;
  return Math.min(100, (d.current_month_cost_usd / d.max_monthly_budget_usd) * 100);
}

function budgetColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function formatCost(usd: number | null | undefined): string {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string) {
  switch (status) {
    case 'active':
      return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
    case 'paused':
      return 'bg-amber-500/10 border-amber-500/25 text-amber-400';
    case 'failed':
      return 'bg-red-500/10 border-red-500/20 text-red-400';
    default:
      return 'bg-secondary/40 border-primary/15 text-muted-foreground/80';
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

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
  const personas = usePersonaStore((s) => s.personas);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedBudget, setSelectedBudget] = useState<number | undefined>(10);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const handleAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try { await action(); } finally { setBusyId(null); }
  };

  const copyEndpoint = (slug: string) => {
    const url = baseUrl ? `${baseUrl}/api/deployed/${slug}` : `/api/deployed/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedId(slug);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className={DEPLOYMENT_TOKENS.panelSpacing}>
      {/* Deploy new persona */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className={`text-sm font-medium text-muted-foreground/90 uppercase tracking-wider ${DEPLOYMENT_TOKENS.sectionHeadingGap}`}>
            Deploy Persona
          </h3>
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-xl
                       bg-secondary/40 border border-primary/15 text-muted-foreground/80
                       hover:text-foreground/95 hover:border-primary/25
                       disabled:opacity-40 transition-colors cursor-pointer"
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
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
                         focus:outline-none focus:border-indigo-500/40
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors"
            >
              <option value="">
                {deployablePersonas.length === 0 ? 'All personas deployed' : 'Select a persona…'}
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
                         focus:outline-none focus:border-indigo-500/40
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors"
            >
              {BUDGET_PRESETS.map((b) => (
                <option key={b.label} value={b.value ?? ''}>{b.label}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleDeploy}
            disabled={!selectedPersonaId || isDeploying}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl
                       bg-indigo-500 text-foreground hover:bg-indigo-600
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {isDeploying ? (
              <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
                <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                <span>Deploying…</span>
                <span className="sr-only">Deploying persona to cloud</span>
              </span>
            ) : (
              <>
                <Rocket className="w-4 h-4" />
                Deploy
              </>
            )}
          </button>
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

          {deployments.map((d) => {
            const endpointUrl = baseUrl ? `${baseUrl}/api/deployed/${d.slug}` : `/api/deployed/${d.slug}`;
            const isBusy = busyId === d.id;

            return (
              <div
                key={d.id}
                className={`p-3 ${DEPLOYMENT_TOKENS.cardRadius} bg-secondary/30 border border-primary/10 space-y-2`}
              >
                {/* Header row: name + status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground/90">
                      {d.label || personaName(d.persona_id)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-lg border font-medium ${statusColor(d.status)}`}>
                      {d.status}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {d.status === 'active' && (
                      <button
                        type="button"
                        title="Pause deployment"
                        onClick={() => handleAction(d.id, () => onPause(d.id))}
                        disabled={isBusy}
                        className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-amber-400
                                   hover:bg-amber-500/10 disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {d.status === 'paused' && (
                      <button
                        type="button"
                        title="Resume deployment"
                        onClick={() => handleAction(d.id, () => onResume(d.id))}
                        disabled={isBusy}
                        className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-emerald-400
                                   hover:bg-emerald-500/10 disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      title="Remove deployment"
                      onClick={() => handleAction(d.id, () => onRemove(d.id))}
                      disabled={isBusy}
                      className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-red-400
                                 hover:bg-red-500/10 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Endpoint URL */}
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 text-xs text-muted-foreground/80 bg-secondary/40 px-2 py-1 rounded-lg truncate border border-primary/10">
                    {endpointUrl}
                  </code>
                  <button
                    type="button"
                    title="Copy endpoint URL"
                    onClick={() => copyEndpoint(d.slug)}
                    className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground/90
                               hover:bg-secondary/50 transition-colors cursor-pointer"
                  >
                    {copiedId === d.slug ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  {baseUrl && (
                    <a
                      href={endpointUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open endpoint"
                      className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground/90
                                 hover:bg-secondary/50 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {/* Budget gauge */}
                {d.max_monthly_budget_usd != null && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground/70">
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        Budget: {formatCost(d.current_month_cost_usd)} / {formatCost(d.max_monthly_budget_usd)}
                      </span>
                      <span>{budgetUtilization(d)?.toFixed(0) ?? 0}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${budgetColor(budgetUtilization(d) ?? 0)}`}
                        style={{ width: `${budgetUtilization(d) ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground/70">
                  <span>Invocations: <span className="text-foreground/80 font-medium">{d.invocation_count}</span></span>
                  <span>Last called: <span className="text-foreground/80">{timeAgo(d.last_invoked_at)}</span></span>
                  <span>Created: <span className="text-foreground/80">{timeAgo(d.created_at)}</span></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
