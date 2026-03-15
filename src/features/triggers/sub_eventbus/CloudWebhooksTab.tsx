import { useState, useEffect, useCallback } from 'react';
import { Cloud, CloudOff, Copy, Check, Plus, Trash2, Webhook, Loader2, RefreshCw } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useCloudWebhookRelay } from '@/hooks/realtime/useCloudWebhookRelay';
import {
  cloudListDeployments, cloudListTriggers, cloudCreateTrigger,
  cloudDeleteTrigger, cloudListTriggerFirings, cloudGetBaseUrl,
  type CloudDeployment, type CloudTrigger, type CloudTriggerFiring,
} from '@/api/system/cloud';
import { formatRelativeTime } from '@/lib/utils/formatters';

interface WebhookTriggerRow {
  trigger: CloudTrigger;
  deployment: CloudDeployment;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
  webhookUrl: string;
}

export function CloudWebhooksTab() {
  const relay = useCloudWebhookRelay();
  const personas = useAgentStore((s) => s.personas);

  const [webhookRows, setWebhookRows] = useState<WebhookTriggerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [createPersonaId, setCreatePersonaId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Firing history
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(null);
  const [firings, setFirings] = useState<CloudTriggerFiring[]>([]);
  const [firingsLoading, setFiringsLoading] = useState(false);

  const fetchWebhookTriggers = useCallback(async () => {
    try {
      const [deployments, url] = await Promise.all([
        cloudListDeployments(),
        cloudGetBaseUrl(),
      ]);

      const webhookEnabled = deployments.filter((d) => d.status === 'active');
      const rows: WebhookTriggerRow[] = [];

      for (const dep of webhookEnabled) {
        try {
          const triggers = await cloudListTriggers(dep.persona_id);
          const webhookTriggers = triggers.filter((t) => t.trigger_type === 'webhook');
          const persona = personas.find((p) => p.id === dep.persona_id);

          for (const trigger of webhookTriggers) {
            rows.push({
              trigger,
              deployment: dep,
              personaName: persona?.name ?? dep.label ?? 'Unknown',
              personaIcon: persona?.icon ?? null,
              personaColor: persona?.color ?? null,
              webhookUrl: url ? `${url}/api/deployed/${dep.slug}` : 'N/A',
            });
          }
        } catch {
          // Skip deployments where triggers can't be fetched
        }
      }

      setWebhookRows(rows);
    } catch {
      // Cloud not connected or error
    } finally {
      setIsLoading(false);
    }
  }, [personas]);

  useEffect(() => {
    fetchWebhookTriggers();
  }, [fetchWebhookTriggers]);

  // Load firings when a trigger is selected
  useEffect(() => {
    if (!selectedTriggerId) {
      setFirings([]);
      return;
    }
    setFiringsLoading(true);
    cloudListTriggerFirings(selectedTriggerId, 20)
      .then(setFirings)
      .catch(() => setFirings([]))
      .finally(() => setFiringsLoading(false));
  }, [selectedTriggerId]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {});
  };

  const handleCreate = async () => {
    if (!createPersonaId) return;
    setIsCreating(true);
    try {
      await cloudCreateTrigger(createPersonaId, 'webhook', JSON.stringify({ event_type: 'webhook' }), true);
      setShowCreate(false);
      setCreatePersonaId('');
      await fetchWebhookTriggers();
    } catch {
      // handled
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (triggerId: string) => {
    try {
      await cloudDeleteTrigger(triggerId);
      setWebhookRows((prev) => prev.filter((r) => r.trigger.id !== triggerId));
      if (selectedTriggerId === triggerId) setSelectedTriggerId(null);
    } catch {
      // handled
    }
  };

  // Deployed personas available for webhook creation
  const deployedPersonaIds = new Set(webhookRows.map((r) => r.deployment.persona_id));

  // Not connected state
  if (!relay.connected && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-muted/30 border border-border/30 flex items-center justify-center">
            <CloudOff className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground/80">Cloud not connected</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Connect to a cloud orchestrator to receive 3rd-party webhooks
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Status banner */}
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-blue-500/5 border border-blue-500/15">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${relay.connected ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`} />
            <span className="text-sm text-foreground/80">
              {relay.connected ? 'Cloud relay active' : 'Connecting...'}
            </span>
            {relay.active_webhook_triggers > 0 && (
              <span className="text-xs text-muted-foreground/60">
                {relay.active_webhook_triggers} webhook{relay.active_webhook_triggers !== 1 ? 's' : ''}
              </span>
            )}
            {relay.total_relayed > 0 && (
              <span className="text-xs text-blue-400/70">
                {relay.total_relayed} relayed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {relay.last_poll_at && (
              <span className="text-xs text-muted-foreground/50">
                Last poll: {formatRelativeTime(relay.last_poll_at)}
              </span>
            )}
            <button
              onClick={() => { setIsLoading(true); fetchWebhookTriggers(); }}
              className="p-1.5 rounded-lg text-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Header + Create button */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
            Cloud Webhook Triggers
          </h3>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Webhook
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground/80 mb-1.5">
                Deployed Persona
              </label>
              <select
                value={createPersonaId}
                onChange={(e) => setCreatePersonaId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500/40"
              >
                <option value="">Select a persona...</option>
                {personas
                  .filter((p) => !deployedPersonaIds.has(p.id) || true)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreate}
                disabled={!createPersonaId || isCreating}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/25 hover:bg-blue-500/25 disabled:opacity-50 transition-colors"
              >
                {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />}
                Create Webhook
              </button>
              <button
                onClick={() => { setShowCreate(false); setCreatePersonaId(''); }}
                className="px-3 py-2 text-sm text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/60" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && webhookRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Webhook className="w-8 h-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground/70">No webhook triggers yet</p>
            <p className="text-sm text-muted-foreground/50 mt-1">
              Create a webhook trigger on a deployed persona to receive 3rd-party POSTs
            </p>
          </div>
        )}

        {/* Webhook triggers list */}
        {!isLoading && webhookRows.length > 0 && (
          <div className="space-y-2">
            {webhookRows.map((row) => (
              <div
                key={row.trigger.id}
                className={`rounded-xl border p-4 transition-colors cursor-pointer ${
                  selectedTriggerId === row.trigger.id
                    ? 'border-blue-500/30 bg-blue-500/5'
                    : 'border-border/30 bg-secondary/10 hover:bg-secondary/20'
                }`}
                onClick={() => setSelectedTriggerId(
                  selectedTriggerId === row.trigger.id ? null : row.trigger.id
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
                      style={{ backgroundColor: (row.personaColor || '#6366f1') + '15' }}
                    >
                      {row.personaIcon || <Cloud className="w-4 h-4 text-foreground/50" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground/90 truncate">{row.personaName}</p>
                      <p className="text-xs text-muted-foreground/60 font-mono truncate">{row.webhookUrl}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {row.trigger.last_triggered_at && (
                      <span className="text-xs text-muted-foreground/50">
                        Last: {formatRelativeTime(row.trigger.last_triggered_at)}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopy(row.webhookUrl, `url-${row.trigger.id}`); }}
                      className="p-1.5 rounded-lg text-foreground/60 hover:text-foreground hover:bg-secondary/50 transition-colors"
                      title="Copy webhook URL"
                    >
                      {copiedId === `url-${row.trigger.id}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {row.deployment.webhook_secret && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopy(row.deployment.webhook_secret!, `secret-${row.trigger.id}`); }}
                        className="px-2 py-1 rounded-lg text-xs text-foreground/60 hover:text-foreground hover:bg-secondary/50 transition-colors border border-border/20"
                        title="Copy webhook secret"
                      >
                        {copiedId === `secret-${row.trigger.id}` ? (
                          <span className="text-emerald-400">Copied</span>
                        ) : (
                          'Secret'
                        )}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(row.trigger.id); }}
                      className="p-1.5 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete webhook trigger"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Firing history for selected trigger */}
        {selectedTriggerId && (
          <div className="space-y-3">
            <h4 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Recent Firings
            </h4>
            {firingsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/60" />
              </div>
            ) : firings.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-4">No firings recorded yet</p>
            ) : (
              <div className="border border-border/30 rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_0.8fr_0.6fr_0.8fr] gap-3 px-4 py-2 bg-secondary/30 border-b border-border/20 text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">
                  <span>Status</span>
                  <span>Fired At</span>
                  <span>Duration</span>
                  <span className="text-right">Cost</span>
                </div>
                {firings.map((f) => (
                  <div key={f.id} className="grid grid-cols-[1fr_0.8fr_0.6fr_0.8fr] gap-3 px-4 py-2.5 border-b border-border/10 last:border-b-0 text-sm">
                    <span className={`font-medium ${
                      f.status === 'completed' ? 'text-emerald-400' :
                      f.status === 'failed' ? 'text-red-400' : 'text-amber-400'
                    }`}>
                      {f.status}
                    </span>
                    <span className="text-foreground/70">
                      {f.fired_at ? formatRelativeTime(f.fired_at) : '—'}
                    </span>
                    <span className="text-foreground/60">
                      {f.duration_ms != null ? `${f.duration_ms}ms` : '—'}
                    </span>
                    <span className="text-right text-foreground/60">
                      {f.cost_usd != null ? `$${f.cost_usd.toFixed(4)}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
