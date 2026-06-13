import { useState, useEffect, useCallback } from 'react';
import { useKeyedCopyFlag } from '@/hooks/utility/interaction/useKeyedCopyFlag';
import { Cloud, CloudOff, Plus, Trash2, Webhook, RefreshCw } from 'lucide-react';
import { CopyButton, Button } from '@/features/shared/components/buttons';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { useAgentStore } from '@/stores/agentStore';
import { useCloudWebhookRelay } from '@/hooks/realtime/useCloudWebhookRelay';
import {
  cloudListDeployments, cloudListTriggers, cloudCreateTrigger,
  cloudDeleteTrigger, cloudListTriggerFirings, cloudGetBaseUrl,
  type CloudDeployment, type CloudTrigger, type CloudTriggerFiring,
} from '@/api/system/cloud';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';


interface WebhookTriggerRow {
  trigger: CloudTrigger;
  deployment: CloudDeployment;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
  webhookUrl: string;
}

export function CloudWebhooksTab() {
  const { t } = useTranslation();
  const relay = useCloudWebhookRelay();
  const personas = useAgentStore((s) => s.personas);

  const [webhookRows, setWebhookRows] = useState<WebhookTriggerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { copiedKey: copiedId, copy } = useKeyedCopyFlag<string>();

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
          const triggers = await cloudListTriggers(dep.personaId);
          const webhookTriggers = triggers.filter((t) => t.triggerType === 'webhook');
          const persona = personas.find((p) => p.id === dep.personaId);

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
        } catch (err) { silentCatch("features/triggers/sub_cloud_webhooks/CloudWebhooksTab:catch1")(err); }
      }

      setWebhookRows(rows);
    } catch (err) { silentCatch("features/triggers/sub_cloud_webhooks/CloudWebhooksTab:catch2")(err); } finally {
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

  const handleCopy = (text: string, id: string) => copy(id, text);

  const handleCreate = async () => {
    if (!createPersonaId) return;
    setIsCreating(true);
    try {
      await cloudCreateTrigger(createPersonaId, 'webhook', JSON.stringify({ event_type: 'webhook' }), true);
      setShowCreate(false);
      setCreatePersonaId('');
      await fetchWebhookTriggers();
    } catch (err) { silentCatch("features/triggers/sub_cloud_webhooks/CloudWebhooksTab:catch3")(err); } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (triggerId: string) => {
    try {
      await cloudDeleteTrigger(triggerId);
      setWebhookRows((prev) => prev.filter((r) => r.trigger.id !== triggerId));
      if (selectedTriggerId === triggerId) setSelectedTriggerId(null);
    } catch (err) { silentCatch("features/triggers/sub_cloud_webhooks/CloudWebhooksTab:catch4")(err); }
  };

  // Deployed personas available for webhook creation
  const deployedPersonaIds = new Set(webhookRows.map((r) => r.deployment.personaId));

  // Not connected state
  if (!relay.connected && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={CloudOff}
          title={t.triggers.cloud_not_connected}
          subtitle={t.triggers.cloud_not_connected_desc}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Status banner */}
        <div className="flex items-center justify-between px-4 py-3 rounded-modal bg-blue-500/5 border border-blue-500/15">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${relay.connected ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/40'}`} />
            <span className="typo-body text-foreground">
              {relay.connected ? t.triggers.cloud_relay_active : t.common.connecting}
            </span>
            {relay.active_webhook_triggers > 0 && (
              <span className="typo-caption text-foreground">
                {relay.active_webhook_triggers} webhook{relay.active_webhook_triggers !== 1 ? 's' : ''}
              </span>
            )}
            {relay.total_relayed > 0 && (
              <span className="typo-caption text-blue-400/70">
                {relay.total_relayed} relayed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {relay.last_poll_at && (
              <span className="typo-caption text-foreground">
                {t.triggers.last_poll_label} {formatRelativeTime(relay.last_poll_at)}
              </span>
            )}
            <button
              onClick={() => { setIsLoading(true); fetchWebhookTriggers(); }}
              className="p-1.5 rounded-card text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              title={t.triggers.refresh_label}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Header + Create button */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-mono text-foreground uppercase tracking-wider">
            {t.triggers.cloud_webhook_triggers}
          </h3>
          <Button variant="accent" accentColor="blue" onClick={() => setShowCreate(!showCreate)} icon={<Plus className="w-3.5 h-3.5" />}>
            {t.triggers.add_webhook}
          </Button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="rounded-modal border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
            <div>
              <label className="block typo-caption font-medium text-foreground mb-1.5">
                {t.triggers.deployed_persona_label}
              </label>
              <select
                value={createPersonaId}
                onChange={(e) => setCreatePersonaId(e.target.value)}
                className="w-full px-3 py-2 typo-body rounded-card border border-border/40 bg-secondary/30 text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500/40"
              >
                <option value="">{t.triggers.select_persona}</option>
                {personas
                  .filter((p) => !deployedPersonaIds.has(p.id) || true)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="accent"
                accentColor="blue"
                onClick={handleCreate}
                disabled={!createPersonaId}
                loading={isCreating}
                icon={<Webhook className="w-3.5 h-3.5" />}
              >
                {t.triggers.create_webhook}
              </Button>
              <Button variant="ghost" onClick={() => { setShowCreate(false); setCreatePersonaId(''); }}>
                {t.common.cancel}
              </Button>
            </div>
          </div>
        )}

        {/* Loading state — shape-matched skeleton rows so chrome lands before data */}
        {isLoading && (
          <ListSkeleton rows={3} rowHeight={64} className="rounded-modal overflow-hidden" />
        )}

        {/* Empty state */}
        {!isLoading && webhookRows.length === 0 && (
          <EmptyState
            icon={Webhook}
            title={t.triggers.no_webhook_triggers}
            subtitle={t.triggers.no_webhook_triggers_desc}
          />
        )}

        {/* Webhook triggers list */}
        {!isLoading && webhookRows.length > 0 && (
          <div className="space-y-2">
            {webhookRows.map((row) => (
              <div
                key={row.trigger.id}
                className={`rounded-modal border p-4 transition-colors cursor-pointer ${
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
                      className="w-8 h-8 rounded-card flex items-center justify-center typo-body border border-primary/15 flex-shrink-0"
                      style={{ backgroundColor: colorWithAlpha(row.personaColor || '#6366f1', 0.08) }}
                    >
                      {row.personaIcon || <Cloud className="w-4 h-4 text-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="typo-body font-medium text-foreground/90 truncate">{row.personaName}</p>
                      <p className="text-xs text-foreground font-mono truncate">{row.webhookUrl}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {row.trigger.lastTriggeredAt && (
                      <span className="typo-caption text-foreground">
                        {t.triggers.last_label} {formatRelativeTime(row.trigger.lastTriggeredAt)}
                      </span>
                    )}
                    <span onClick={(e) => e.stopPropagation()}>
                      <CopyButton
                        copied={copiedId === `url-${row.trigger.id}`}
                        onCopy={() => handleCopy(row.webhookUrl, `url-${row.trigger.id}`)}
                        tooltip={t.triggers.copy_webhook_url_title}
                      />
                    </span>
                    {row.deployment.webhookSecret && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <CopyButton
                          copied={copiedId === `secret-${row.trigger.id}`}
                          onCopy={() => handleCopy(row.deployment.webhookSecret!, `secret-${row.trigger.id}`)}
                          label={t.triggers.secret_label}
                          copiedLabel={t.common.copied}
                          tooltip={t.triggers.copy_webhook_secret_title}
                        />
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(row.trigger.id); }}
                      className="p-1.5 rounded-card text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title={t.triggers.delete_webhook_title}
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
            <h4 className="text-sm font-mono text-foreground uppercase tracking-wider">
              {t.triggers.recent_firings}
            </h4>
            {firingsLoading ? (
              <ListSkeleton rows={3} rowHeight={40} leading={false} className="border border-border/30 rounded-modal overflow-hidden" />
            ) : firings.length === 0 ? (
              <p className="typo-body text-foreground py-4">{t.triggers.no_firings}</p>
            ) : (
              <div className="border border-border/30 rounded-modal overflow-hidden">
                <div className="grid grid-cols-[1fr_0.8fr_0.6fr_0.8fr] gap-3 px-4 py-2 bg-secondary/30 border-b border-border/20 text-xs font-mono text-foreground uppercase tracking-wider">
                  <span>{t.triggers.status_col_label}</span>
                  <span>{t.triggers.fired_at_label}</span>
                  <span>{t.triggers.duration_col_label}</span>
                  <span className="text-right">{t.triggers.cost_col_label}</span>
                </div>
                {firings.map((f) => (
                  <div key={f.id} className="grid grid-cols-[1fr_0.8fr_0.6fr_0.8fr] gap-3 px-4 py-2.5 border-b border-border/10 last:border-b-0 typo-body">
                    <span className={`font-medium ${
                      f.status === 'completed' ? 'text-emerald-400' :
                      f.status === 'failed' ? 'text-red-400' : 'text-amber-400'
                    }`}>
                      {f.status}
                    </span>
                    <span className="text-foreground">
                      {f.firedAt ? formatRelativeTime(f.firedAt) : '—'}
                    </span>
                    <span className="text-foreground">
                      {f.durationMs != null ? `${f.durationMs}ms` : '—'}
                    </span>
                    <span className="text-right text-foreground">
                      {f.costUsd != null ? `$${f.costUsd.toFixed(4)}` : '—'}
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
