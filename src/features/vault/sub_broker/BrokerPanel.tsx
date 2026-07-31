import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, KeyRound, Activity, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import {
  listBrokerConsumers,
  listBrokerConsumerActivity,
  revokeBrokerConsumer,
  type BrokerConsumer,
  type BrokerConsumerActivityEntry,
} from '@/api/credentials/broker';

/**
 * Zero-Plaintext Broker — minimal vault surface.
 *
 * Lists every external consumer identity observed using credentials through
 * the audited proxy, with a per-consumer kill-switch (revoke the consumer's
 * key) and an expandable recent-activity trail. Secrets never appear here —
 * only key prefixes and usage metadata.
 */
export function BrokerPanel() {
  const { t } = useTranslation();
  const b = t.vault.broker;

  const [consumers, setConsumers] = useState<BrokerConsumer[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoadError(false);
      setConsumers(await listBrokerConsumers());
    } catch {
      setLoadError(true);
      setConsumers([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      {/* Intro + honest exclusion copy */}
      <div className="rounded-modal border border-primary/15 bg-secondary/30 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="typo-body font-medium text-foreground">{b.title}</span>
        </div>
        <p className="typo-caption text-foreground leading-relaxed">{b.subtitle}</p>
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-card bg-amber-500/8 border border-amber-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="typo-caption text-foreground leading-relaxed">{b.exclusion_note}</p>
        </div>
      </div>

      {/* Consumer list */}
      <div>
        <div className="typo-caption font-medium text-foreground mb-2">{b.consumers_header}</div>

        {consumers === null && !loadError && (
          <div className="typo-caption text-foreground px-1 py-2">{b.loading}…</div>
        )}
        {loadError && (
          <div className="typo-caption text-red-400 px-1 py-2">{b.load_error}</div>
        )}
        {consumers !== null && !loadError && consumers.length === 0 && (
          <div className="rounded-modal border border-dashed border-primary/15 bg-secondary/20 p-6 text-center space-y-1">
            <KeyRound className="w-5 h-5 text-foreground opacity-60 mx-auto" />
            <div className="typo-body text-foreground/85">{b.empty_title}</div>
            <p className="typo-caption text-foreground leading-relaxed">{b.empty_body}</p>
          </div>
        )}

        <div className="space-y-2">
          {(consumers ?? []).map((c) => (
            <ConsumerRow key={c.consumerKeyId} consumer={c} onChanged={refresh} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ConsumerRow({ consumer, onChanged }: { consumer: BrokerConsumer; onChanged: () => Promise<void> }) {
  const { t, tx } = useTranslation();
  const b = t.vault.broker;

  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState<BrokerConsumerActivityEntry[] | null>(null);

  const status = consumer.active
    ? { label: b.status_active, cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' }
    : consumer.revokedAt
      ? { label: b.status_revoked, cls: 'bg-red-500/10 text-red-400 border-red-500/25' }
      : { label: b.status_inactive, cls: 'bg-secondary/50 text-muted-foreground border-primary/15' };

  const toggleActivity = async () => {
    const next = !showActivity;
    setShowActivity(next);
    if (next && activity === null) {
      try {
        setActivity(await listBrokerConsumerActivity(consumer.consumerKeyId, 25));
      } catch {
        setActivity([]);
      }
    }
  };

  const revoke = async () => {
    setRevoking(true);
    try {
      await revokeBrokerConsumer(consumer.consumerKeyId);
      await onChanged();
    } catch (e) {
      toastCatch('BrokerPanel:revoke', b.revoke_error)(e);
    } finally {
      setRevoking(false);
      setConfirming(false);
    }
  };

  return (
    <div className="rounded-modal border border-primary/15 bg-secondary/30 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <KeyRound className="w-4 h-4 text-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="typo-body font-medium text-foreground truncate">{consumer.consumerName}</span>
            {consumer.keyPrefix && (
              <span className="typo-code font-mono text-foreground">{consumer.keyPrefix}…</span>
            )}
            <span className={`px-1.5 py-0.5 typo-caption rounded-card border ${status.cls}`}>{status.label}</span>
          </div>
          <div className="typo-caption text-foreground flex flex-wrap gap-x-3 mt-0.5">
            <span>{tx(consumer.totalCalls === 1 ? b.calls_one : b.calls_other, { count: consumer.totalCalls })}</span>
            {consumer.lastUsedAt && (
              <span>{b.last_used} {new Date(consumer.lastUsedAt).toLocaleString()}</span>
            )}
            {consumer.active && consumer.expiresAt && (
              <span>{b.expires} {new Date(consumer.expiresAt).toLocaleString()}</span>
            )}
          </div>
          {consumer.credentialNames.length > 0 && (
            <div className="typo-caption text-foreground mt-0.5 truncate">
              {b.credentials_used}: {consumer.credentialNames.join(', ')}
            </div>
          )}
        </div>

        {/* Kill-switch (two-step confirm) */}
        {consumer.active && (
          confirming ? (
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={revoking}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-card border border-red-500/40 bg-red-500/15 text-red-400 typo-caption font-medium hover:bg-red-500/25 transition-colors cursor-pointer disabled:opacity-50"
              title={b.kill_switch_hint}
            >
              <ShieldOff className="w-3.5 h-3.5" />
              {revoking ? b.revoking : b.kill_switch_confirm}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              onBlur={() => setConfirming(false)}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-card border border-primary/15 bg-secondary/40 text-foreground typo-caption hover:border-red-500/40 hover:text-red-400 transition-colors cursor-pointer"
              title={b.kill_switch_hint}
            >
              <ShieldOff className="w-3.5 h-3.5" />
              {b.kill_switch}
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => void toggleActivity()}
          className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-card text-foreground typo-caption hover:bg-secondary/50 transition-colors cursor-pointer"
        >
          <Activity className="w-3.5 h-3.5" />
          {showActivity ? b.activity_hide : b.activity_show}
          {showActivity ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {showActivity && (
        <div className="border-t border-primary/10 px-3 py-2 bg-secondary/20">
          {activity === null ? (
            <div className="typo-caption text-foreground">{b.activity_loading}…</div>
          ) : activity.length === 0 ? (
            <div className="typo-caption text-foreground">{b.activity_empty}</div>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {activity.map((a) => (
                <div key={a.id} className="flex items-center gap-2 typo-caption font-mono">
                  <span className={a.status >= 400 ? 'text-red-400' : 'text-emerald-400'}>{a.status}</span>
                  <span className="text-foreground">{a.method}</span>
                  <span className="text-foreground/85 truncate flex-1">{a.path}</span>
                  <span className="text-foreground shrink-0">{new Date(a.at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
