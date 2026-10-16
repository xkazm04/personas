import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldOff, KeyRound, Activity, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { Button } from '@/features/shared/components/buttons';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { ConfirmPopover } from '@/features/shared/components/feedback/ConfirmPopover';
import {
  listBrokerConsumers,
  listBrokerConsumerActivity,
  revokeBrokerConsumer,
  type BrokerConsumer,
  type BrokerConsumerActivityEntry,
} from '@/api/credentials/broker';

/**
 * Zero-Plaintext Broker — vault surface.
 *
 * Lists every external consumer identity observed using credentials through
 * the audited proxy, with a per-consumer kill-switch (revoke the consumer's
 * key) and an expandable recent-activity trail. Secrets never appear here —
 * only key prefixes and usage metadata.
 *
 * Composed from the same kit as the Settings tabs: the vault's ContentHeader
 * already names the page, so the body is SectionCards on a centred column.
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
    <div className="mx-auto w-full max-w-4xl space-y-6" data-testid="broker-panel">
      <SectionCard
        title={b.title}
        subtitle={b.subtitle}
        icon={<ShieldCheck className="w-4 h-4 text-primary/60" />}
        titleClassName="text-primary"
      >
        <Banner severity="warning" compact neutralBody message={b.exclusion_note} />
      </SectionCard>

      <SectionCard
        title={b.consumers_header}
        icon={<Users className="w-4 h-4 text-primary/60" />}
        titleClassName="text-primary"
      >
        {consumers === null && !loadError && <ListSkeleton rows={3} rowHeight={56} leading />}
        {loadError && (
          <Banner severity="error" compact message={b.load_error} onRetry={() => void refresh()} />
        )}
        {consumers !== null && !loadError && consumers.length === 0 && (
          <ScenarioEmptyState icon={KeyRound} size="sm" title={b.empty_title} subtitle={b.empty_body} />
        )}
        {consumers !== null && consumers.length > 0 && (
          <div className="divide-y divide-foreground/5">
            {consumers.map((c) => (
              <ConsumerRow key={c.consumerKeyId} consumer={c} onChanged={refresh} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function ConsumerRow({ consumer, onChanged }: { consumer: BrokerConsumer; onChanged: () => Promise<void> }) {
  const { t, tx } = useTranslation();
  const b = t.vault.broker;

  const killRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState<BrokerConsumerActivityEntry[] | null>(null);

  const status = consumer.active
    ? { label: b.status_active, variant: 'success' as const }
    : consumer.revokedAt
      ? { label: b.status_revoked, variant: 'error' as const }
      : { label: b.status_inactive, variant: 'neutral' as const };

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

  // ConfirmPopover holds a real spinner while this is pending and the caller
  // closes it, so the revoke cannot be abandoned half-way or fired twice.
  const revoke = async () => {
    try {
      await revokeBrokerConsumer(consumer.consumerKeyId);
      await onChanged();
    } catch (e) {
      toastCatch('BrokerPanel:revoke', b.revoke_error)(e);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-primary/15 bg-primary/5">
          <KeyRound className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="typo-body-lg text-foreground truncate">{consumer.consumerName}</span>
            {consumer.keyPrefix && (
              <span className="typo-code text-foreground shrink-0">{consumer.keyPrefix}…</span>
            )}
            <StatusBadge variant={status.variant} size="sm">{status.label}</StatusBadge>
          </div>
          <div className="typo-caption text-foreground flex flex-wrap gap-x-4 gap-y-0.5">
            <span>{tx(consumer.totalCalls === 1 ? b.calls_one : b.calls_other, { count: consumer.totalCalls })}</span>
            {consumer.lastUsedAt && (
              <span>{b.last_used} <RelativeTime timestamp={consumer.lastUsedAt} /></span>
            )}
            {consumer.active && consumer.expiresAt && (
              <span>{b.expires} <RelativeTime timestamp={consumer.expiresAt} /></span>
            )}
          </div>
          {consumer.credentialNames.length > 0 && (
            <div className="typo-caption text-foreground truncate">
              {b.credentials_used}: {consumer.credentialNames.join(', ')}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {consumer.active && (
            <Button
              ref={killRef}
              variant="danger"
              size="sm"
              icon={<ShieldOff className="w-3.5 h-3.5" />}
              onClick={() => setConfirming(true)}
              aria-haspopup="dialog"
              aria-expanded={confirming}
            >
              {b.kill_switch}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<Activity className="w-3.5 h-3.5" />}
            iconRight={showActivity ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            onClick={() => void toggleActivity()}
            aria-expanded={showActivity}
          >
            {showActivity ? b.activity_hide : b.activity_show}
          </Button>
        </div>
      </div>

      <ConfirmPopover
        open={confirming}
        anchorRef={killRef}
        title={b.kill_switch_confirm}
        detail={b.kill_switch_hint}
        confirmLabel={b.kill_switch}
        confirmIcon={<ShieldOff className="w-3.5 h-3.5" />}
        tone="danger"
        onConfirm={revoke}
        onCancel={() => setConfirming(false)}
      />

      {showActivity && (
        <div className="mt-3 ml-11 rounded-card border border-primary/10 bg-secondary/20 px-3 py-2">
          {activity === null ? (
            <ListSkeleton rows={3} rowHeight={20} />
          ) : activity.length === 0 ? (
            <div className="typo-caption text-foreground">{b.activity_empty}</div>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {activity.map((a) => (
                <div key={a.id} className="grid grid-cols-[3rem_4rem_minmax(0,1fr)_auto] items-center gap-2 typo-code">
                  <span className={a.status >= 400 ? 'text-status-error' : 'text-status-success'}>{a.status}</span>
                  <span className="text-foreground">{a.method}</span>
                  <span className="text-foreground truncate">{a.path}</span>
                  <RelativeTime timestamp={a.at} className="typo-caption text-foreground" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
