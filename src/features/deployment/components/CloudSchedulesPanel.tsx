import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Loader2,
  Plus,
  Clock,
  Webhook,
  Play,
  Pause,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import {
  cloudListTriggers,
  cloudCreateTrigger,
  cloudUpdateTrigger,
  cloudDeleteTrigger,
  cloudListTriggerFirings,
} from '@/api/cloud';
import type { CloudTrigger, CloudTriggerFiring, CloudDeployment } from '@/api/cloud';
import { DEPLOYMENT_TOKENS } from './deploymentTokens';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function triggerTypeLabel(type: string): string {
  switch (type) {
    case 'schedule': return 'Scheduled (Cron)';
    case 'polling': return 'Polling';
    case 'webhook': return 'Webhook';
    case 'chain': return 'Chain';
    case 'manual': return 'Manual';
    default: return type;
  }
}

function triggerTypeIcon(type: string) {
  switch (type) {
    case 'schedule': return <Clock className="w-3.5 h-3.5" />;
    case 'webhook': return <Webhook className="w-3.5 h-3.5" />;
    case 'chain': return <Zap className="w-3.5 h-3.5" />;
    default: return <Clock className="w-3.5 h-3.5" />;
  }
}

function healthBadge(status: string | null) {
  if (!status || status === 'healthy') {
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle2 className="w-2.5 h-2.5" />Healthy</span>;
  }
  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"><AlertTriangle className="w-2.5 h-2.5" />{status}</span>;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatCost(usd: number | null): string {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function parseConfig(configStr: string | null): Record<string, unknown> {
  if (!configStr) return {};
  try { return JSON.parse(configStr); }
  catch { return {}; }
}

// Cron presets for quick setup
const CRON_PRESETS = [
  { label: 'Every 5 min', cron: '*/5 * * * *' },
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at midnight', cron: '0 0 * * *' },
  { label: 'Daily at 9am', cron: '0 9 * * *' },
  { label: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
  { label: 'Weekly (Sun midnight)', cron: '0 0 * * 0' },
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  deployments: CloudDeployment[];
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CloudSchedulesPanel({ deployments, onRefresh }: Props) {
  const personas = usePersonaStore((s) => s.personas);

  const [triggers, setTriggers] = useState<CloudTrigger[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [firings, setFirings] = useState<CloudTriggerFiring[]>([]);
  const [isLoadingFirings, setIsLoadingFirings] = useState(false);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [createPersonaId, setCreatePersonaId] = useState('');
  const [createType, setCreateType] = useState<'schedule' | 'webhook'>('schedule');
  const [createCron, setCreateCron] = useState('0 * * * *');
  const [isCreating, setIsCreating] = useState(false);

  // Deployed persona IDs
  const deployedPersonaIds = useMemo(
    () => new Set(deployments.filter((d) => d.status === 'active').map((d) => d.persona_id)),
    [deployments],
  );

  const deployedPersonas = useMemo(
    () => personas.filter((p) => deployedPersonaIds.has(p.id)),
    [personas, deployedPersonaIds],
  );

  const personaName = useCallback(
    (id: string) => personas.find((p) => p.id === id)?.name ?? id.slice(0, 8),
    [personas],
  );

  // Fetch all triggers for all deployed personas
  const fetchTriggers = useCallback(async () => {
    if (deployedPersonaIds.size === 0) {
      setTriggers([]);
      return;
    }
    setIsLoading(true);
    try {
      const results = await Promise.all(
        Array.from(deployedPersonaIds).map((pid) => cloudListTriggers(pid).catch(() => [] as CloudTrigger[])),
      );
      setTriggers(results.flat());
    } finally {
      setIsLoading(false);
    }
  }, [deployedPersonaIds]);

  useEffect(() => { fetchTriggers(); }, [fetchTriggers]);

  // Fetch firings when expanding a trigger
  useEffect(() => {
    if (!expandedId) {
      setFirings([]);
      return;
    }
    setIsLoadingFirings(true);
    cloudListTriggerFirings(expandedId, 10)
      .then(setFirings)
      .catch(() => setFirings([]))
      .finally(() => setIsLoadingFirings(false));
  }, [expandedId]);

  // Create handler
  const handleCreate = async () => {
    if (!createPersonaId || isCreating) return;
    setIsCreating(true);
    try {
      const config = createType === 'schedule'
        ? JSON.stringify({ cron: createCron })
        : JSON.stringify({ event_type: 'webhook' });
      await cloudCreateTrigger(createPersonaId, createType, config, true);
      setShowCreate(false);
      setCreateCron('0 * * * *');
      await fetchTriggers();
    } finally {
      setIsCreating(false);
    }
  };

  // Toggle enabled
  const handleToggle = async (trigger: CloudTrigger) => {
    await cloudUpdateTrigger(trigger.id, undefined, undefined, !trigger.enabled);
    await fetchTriggers();
  };

  // Delete
  const handleDelete = async (triggerId: string) => {
    await cloudDeleteTrigger(triggerId);
    if (expandedId === triggerId) setExpandedId(null);
    await fetchTriggers();
  };

  return (
    <div className={DEPLOYMENT_TOKENS.panelSpacing}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground/90 uppercase tracking-wider">
          Cloud Triggers ({triggers.length})
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/25 hover:bg-indigo-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Trigger
          </button>
          <button
            onClick={() => { fetchTriggers(); onRefresh(); }}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-secondary/40 border border-primary/15 text-muted-foreground/80 hover:text-foreground/95 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl bg-secondary/30 border border-indigo-500/15 p-4 space-y-3">
          <h4 className="text-sm font-medium text-foreground/90">New Cloud Trigger</h4>

          {/* Persona selector */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground/70">Persona (must be deployed)</label>
            <select
              value={createPersonaId}
              onChange={(e) => setCreatePersonaId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus:outline-none focus:border-indigo-500/40 transition-colors"
            >
              <option value="">Select persona...</option>
              {deployedPersonas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Trigger type */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground/70">Trigger Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setCreateType('schedule')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border transition-colors ${
                  createType === 'schedule'
                    ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                    : 'bg-secondary/40 text-muted-foreground/70 border-primary/15 hover:border-primary/25'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Schedule (Cron)
              </button>
              <button
                onClick={() => setCreateType('webhook')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border transition-colors ${
                  createType === 'webhook'
                    ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                    : 'bg-secondary/40 text-muted-foreground/70 border-primary/15 hover:border-primary/25'
                }`}
              >
                <Webhook className="w-3.5 h-3.5" />
                Webhook
              </button>
            </div>
          </div>

          {/* Cron config */}
          {createType === 'schedule' && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground/70">Cron Expression</label>
              <input
                type="text"
                value={createCron}
                onChange={(e) => setCreateCron(e.target.value)}
                placeholder="0 * * * *"
                className="w-full px-3 py-1.5 text-sm font-mono rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus:outline-none focus:border-indigo-500/40 transition-colors"
              />
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((preset) => (
                  <button
                    key={preset.cron}
                    onClick={() => setCreateCron(preset.cron)}
                    className={`px-2 py-1 text-xs rounded-lg border transition-colors ${
                      createCron === preset.cron
                        ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25'
                        : 'bg-secondary/30 text-muted-foreground/60 border-primary/10 hover:border-primary/20'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Webhook info */}
          {createType === 'webhook' && (
            <p className="text-xs text-muted-foreground/60">
              A webhook endpoint will be created for this trigger. You can configure payload filtering after creation.
            </p>
          )}

          {/* Create actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={!createPersonaId || isCreating}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25 disabled:opacity-40 transition-colors"
            >
              {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {isCreating ? 'Creating...' : 'Create Trigger'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-sm rounded-xl border border-primary/15 text-muted-foreground/70 hover:bg-secondary/40 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* No deployments notice */}
      {deployments.filter((d) => d.status === 'active').length === 0 && (
        <p className="text-sm text-muted-foreground/60 py-6 text-center">
          Deploy a persona first to create cloud triggers.
        </p>
      )}

      {/* Trigger list */}
      {triggers.length === 0 && deployedPersonaIds.size > 0 ? (
        <p className="text-sm text-muted-foreground/60 py-6 text-center">
          {isLoading ? 'Loading triggers...' : 'No cloud triggers yet. Create one to schedule automated runs.'}
        </p>
      ) : (
        <div className="space-y-1">
          {triggers.map((trigger) => {
            const isExpanded = expandedId === trigger.id;
            const config = parseConfig(trigger.config);

            return (
              <div key={trigger.id} className="rounded-lg bg-secondary/30 border border-primary/10 overflow-hidden">
                {/* Row */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : trigger.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-secondary/50 transition-colors cursor-pointer"
                >
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  <span className={`${trigger.enabled ? 'text-indigo-400' : 'text-muted-foreground/50'}`}>
                    {triggerTypeIcon(trigger.trigger_type)}
                  </span>
                  <span className="text-sm text-foreground/80 truncate flex-1">
                    {personaName(trigger.persona_id)}
                    <span className="text-muted-foreground/50 ml-2">{triggerTypeLabel(trigger.trigger_type)}</span>
                  </span>
                  {config.cron && (
                    <span className="text-xs font-mono text-muted-foreground/60 bg-secondary/50 px-1.5 py-0.5 rounded">
                      {String(config.cron)}
                    </span>
                  )}
                  {healthBadge(trigger.health_status)}
                  <span className={`w-2 h-2 rounded-full ${trigger.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} title={trigger.enabled ? 'Enabled' : 'Disabled'} />
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-primary/10 space-y-3">
                    {/* Trigger info */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-muted-foreground/60">Type:</span> <span className="text-foreground/80">{triggerTypeLabel(trigger.trigger_type)}</span></div>
                      <div><span className="text-muted-foreground/60">Status:</span> <span className="text-foreground/80">{trigger.enabled ? 'Enabled' : 'Disabled'}</span></div>
                      <div><span className="text-muted-foreground/60">Last triggered:</span> <span className="text-foreground/80">{timeAgo(trigger.last_triggered_at)}</span></div>
                      <div><span className="text-muted-foreground/60">Next trigger:</span> <span className="text-foreground/80">{trigger.next_trigger_at ? new Date(trigger.next_trigger_at).toLocaleString() : '-'}</span></div>
                      {config.cron && <div className="col-span-2"><span className="text-muted-foreground/60">Cron:</span> <span className="text-foreground/80 font-mono">{String(config.cron)}</span></div>}
                      {trigger.health_message && (
                        <div className="col-span-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/10 text-xs text-amber-400">
                          {trigger.health_message}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggle(trigger)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                          trigger.enabled
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/15'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15'
                        }`}
                      >
                        {trigger.enabled ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Enable</>}
                      </button>
                      <button
                        onClick={() => handleDelete(trigger.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/15 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>

                    {/* Recent firings */}
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-2">
                        Recent Firings
                      </h4>
                      {isLoadingFirings ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground/50 py-2">
                          <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                        </div>
                      ) : firings.length === 0 ? (
                        <p className="text-xs text-muted-foreground/50">No firings recorded yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {firings.map((f) => (
                            <div key={f.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg bg-secondary/20 border border-primary/5">
                              {f.status === 'completed' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> :
                               f.status === 'failed' ? <XCircle className="w-3 h-3 text-red-400" /> :
                               <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
                              <span className="text-muted-foreground/70">{f.status}</span>
                              <span className="text-muted-foreground/50 flex-1">{timeAgo(f.fired_at)}</span>
                              {f.duration_ms != null && <span className="text-muted-foreground/50">{f.duration_ms < 1000 ? `${f.duration_ms}ms` : `${(f.duration_ms / 1000).toFixed(1)}s`}</span>}
                              <span className="text-muted-foreground/50">{formatCost(f.cost_usd)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
