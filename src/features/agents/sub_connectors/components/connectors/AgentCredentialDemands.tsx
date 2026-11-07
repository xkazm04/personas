import { useState, useCallback, useMemo } from 'react';
import { Key, Plug, ArrowRight, CheckCircle2, AlertTriangle, Sparkles, Wand2 } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { CredentialDesignModal } from '@/features/vault/sub_catalog/components/design/CredentialDesignModal';
import { mutateCredentialLink } from '@/hooks/design/core/useDesignContextMutator';
import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useToastStore } from '@/stores/toastStore';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useUnfulfilledCredentials, type UnfulfilledCredential } from '../../libs/useUnfulfilledCredentials';
import { partitionDemands } from '../../libs/fulfillDemands';
import { useTranslation } from '@/i18n/useTranslation';

import { isCredentialVerified } from '@/lib/credentials/healthState';
import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons';
export function AgentCredentialDemands() {
  const { t, tx } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const { totalDemands, fulfilledCount, unfulfilledCount, reusableCount, demands } = useUnfulfilledCredentials();

  const [designOpen, setDesignOpen] = useState(false);
  const [designInstruction, setDesignInstruction] = useState('');
  const [linkingDemand, setLinkingDemand] = useState<string | null>(null);
  // Connector names still owed a created credential after the batch link.
  // The design modal takes one instruction at a time, so the remainder is
  // walked as a queue rather than asking the operator to reopen it per slot.
  const [designQueue, setDesignQueue] = useState<string[]>([]);
  const addToast = useToastStore((s) => s.addToast);

  const partition = useMemo(() => partitionDemands(demands), [demands]);

  const handleProvision = useCallback((demand: UnfulfilledCredential) => {
    setDesignInstruction(`${demand.connectorLabel} API credential`);
    setDesignOpen(true);
  }, []);

  const handleReuse = useCallback(async (demand: UnfulfilledCredential, credentialId: string) => {
    if (!selectedPersona) return;
    // `mutateCredentialLink` resolves `{ applied: false, reason }` on failure --
    // it does not reject -- so the catch that used to stand here could never
    // run. A link that never persisted closed the picker exactly like one that
    // did, and the demand card stayed on screen with no explanation.
    const outcome = await mutateCredentialLink(selectedPersona.id, demand.connectorName, credentialId);
    if (!outcome.applied) {
      toastCatch(
        "AgentCredentialDemands:mutateCredentialLink",
        tx(t.agents.connectors.test_link_failed, { error: outcome.reason }),
      )(new Error(outcome.reason));
      setLinkingDemand(null);
      return;
    }
    await fetchCredentials().catch(silentCatch("AgentCredentialDemands:fetchCredentialsAfterReuse"));
    setLinkingDemand(null);
  }, [selectedPersona, fetchCredentials, t, tx]);

  const handleDesignComplete = useCallback(() => {
    void fetchCredentials().catch(toastCatch("AgentCredentialDemands:fetchCredentialsOnDesignComplete", "Failed to refresh credentials after setup"));
    // Advance the queue in place. Closing on the last one is what ends the run;
    // a queue that reopened itself on an empty tail would trap the operator.
    setDesignQueue((queue) => {
      const [, ...rest] = queue;
      const next = rest[0];
      if (next) {
        setDesignInstruction(`${next} API credential`);
        return rest;
      }
      setDesignOpen(false);
      setDesignInstruction('');
      return [];
    });
  }, [fetchCredentials]);

  /**
   * Settle everything that can be settled without a question, then queue the
   * rest into one modal run.
   *
   * The links are written SEQUENTIALLY on purpose: they are all edits to the
   * same persona's `design_context`, so fanning them out would be several
   * read-modify-writes racing over one blob.
   */
  const handleFulfillRemaining = useCallback(async () => {
    if (!selectedPersona) return;
    let linked = 0;
    const failures: string[] = [];
    for (const { demand, credentialId } of partition.autoLinkable) {
      const outcome = await mutateCredentialLink(selectedPersona.id, demand.connectorName, credentialId);
      if (outcome.applied) linked += 1;
      else failures.push(demand.connectorLabel);
    }
    if (linked > 0) {
      await fetchCredentials().catch(silentCatch('AgentCredentialDemands:fetchCredentialsAfterFulfill'));
    }
    // Name what did not land. "3 of 5" tells the operator that something went
    // wrong and nothing about which connector to go look at.
    if (failures.length > 0) {
      addToast(
        tx(t.agents.connectors.dm_fulfill_partial, {
          linked,
          total: partition.autoLinkable.length,
          connectors: failures.join(', '),
        }),
        linked > 0 ? 'warning' : 'error',
      );
    } else if (linked > 0) {
      addToast(tx(t.agents.connectors.dm_fulfill_linked, { count: linked }), 'success');
    }

    const queue = partition.missing.map((d) => d.connectorLabel);
    if (queue.length > 0) {
      setDesignQueue(queue);
      setDesignInstruction(`${queue[0]} API credential`);
      setDesignOpen(true);
    }
  }, [selectedPersona, partition, fetchCredentials, addToast, t, tx]);

  if (totalDemands === 0 || unfulfilledCount === 0) return null;

  return (
    <div className="space-y-3">
      {/* Summary banner */}
      <div className="flex items-start gap-2.5 p-3 rounded-modal bg-role-agent/5 border border-role-agent/15">
        <Key className="w-4 h-4 text-role-agent flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="typo-body text-role-agent">
            {tx(t.agents.connectors.dm_needed, { count: unfulfilledCount })}
          </p>
          <p className="typo-caption text-role-agent mt-0.5">
            {tx(t.agents.connectors.dm_fulfilled, { fulfilled: fulfilledCount, total: totalDemands })}
            {reusableCount > 0 && (
              <span> &middot; {tx(t.agents.connectors.dm_reuse_hint, { count: reusableCount })}</span>
            )}
          </p>
        </div>
        {(partition.autoLinkable.length > 0 || partition.missing.length > 0) && (
          <AsyncButton
            size="xs"
            variant="ghost"
            data-testid="fulfill-remaining"
            icon={<Wand2 className="w-3.5 h-3.5" />}
            onClick={handleFulfillRemaining}
          >
            {tx(t.agents.connectors.dm_fulfill_remaining, {
              count: partition.autoLinkable.length + partition.missing.length,
            })}
          </AsyncButton>
        )}
      </div>

      {/* Demand cards */}
      <div className="space-y-2">
        {demands.map((demand) => (
          <DemandCard
            key={demand.connectorName}
            demand={demand}
            isLinking={linkingDemand === demand.connectorName}
            onProvision={() => handleProvision(demand)}
            onToggleLinking={() => setLinkingDemand((p) => p === demand.connectorName ? null : demand.connectorName)}
            onReuse={(credId) => void handleReuse(demand, credId)}
          />
        ))}
      </div>

      {/* Design modal */}
      {designOpen && (
        <div className="mt-3 border border-role-agent/20 rounded-modal overflow-hidden">
          {designQueue.length > 1 && (
            <p
              data-testid="fulfill-queue-progress"
              className="px-3 py-1.5 typo-caption text-role-agent border-b border-role-agent/15"
            >
              {tx(t.agents.connectors.dm_queue_progress, {
                remaining: designQueue.length,
                connector: designQueue[0] ?? '',
              })}
            </p>
          )}
          <CredentialDesignModal
            open={designOpen}
            embedded
            initialInstruction={designInstruction}
            onClose={() => { setDesignOpen(false); setDesignInstruction(''); setDesignQueue([]); }}
            onComplete={handleDesignComplete}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demand card
// ---------------------------------------------------------------------------

function DemandCard({
  demand,
  isLinking,
  onProvision,
  onToggleLinking,
  onReuse,
}: {
  demand: UnfulfilledCredential;
  isLinking: boolean;
  onProvision: () => void;
  onToggleLinking: () => void;
  onReuse: (credentialId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const hasReusable = demand.matchingCredentials.length > 0;

  return (
    <div className="rounded-modal border border-hair bg-surface-1 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {/* Connector icon */}
        <div
          className="w-7 h-7 rounded-card flex items-center justify-center flex-shrink-0"
          style={{ background: `${demand.connectorColor}15`, border: `1px solid ${demand.connectorColor}30` }}
        >
          <Plug className="w-3.5 h-3.5" style={{ color: demand.connectorColor }} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="typo-body text-ink-1">{demand.connectorLabel}</span>
            <AlertTriangle className="w-3 h-3 text-status-warning" />
          </div>
          <p className="typo-caption text-ink-2 truncate">
            {t.agents.connectors.dm_required_by}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasReusable && (
            <Button
              type="button"
              onClick={onToggleLinking}
              aria-expanded={isLinking}
              variant={isLinking ? 'secondary' : 'ghost'}
              size="sm"
              icon={<ArrowRight className="w-3 h-3" />}
            >{tx(t.agents.connectors.dm_reuse, { count: demand.matchingCredentials.length })}</Button>
          )}
          <Button
            type="button"
            onClick={onProvision}
            variant="accent"
            tone="agent"
            size="sm"
            icon={<Sparkles className="w-3 h-3" />}
          >{t.agents.connectors.dm_create}</Button>
        </div>
      </div>

      {/* Reusable credentials dropdown */}
      {isLinking && hasReusable && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-1 border-t border-hair space-y-1">
              <p className="typo-caption text-ink-2 mb-1.5">
                {t.agents.connectors.dm_link_existing}
              </p>
              {demand.matchingCredentials.map((cred) => (
                <PressSurface
                  key={cred.id}
                  onPress={() => onReuse(cred.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-card"
                >
                  <Key className="w-3 h-3 text-status-success" />
                  <span className="typo-caption text-ink-2 flex-1 truncate">{cred.name}</span>
                  {isCredentialVerified(cred) && (
                    <CheckCircle2 className="w-3 h-3 text-status-success" />
                  )}
                  {cred.healthcheck_last_success === false && (
                    <AlertTriangle className="w-3 h-3 text-status-error" />
                  )}
                </PressSurface>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}
