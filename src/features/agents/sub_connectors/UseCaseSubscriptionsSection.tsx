import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronDown, Radio } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import { SectionCard } from '@/features/shared/components/SectionCard';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import { UseCaseSubscriptions } from '@/features/agents/sub_use_cases/UseCaseSubscriptions';
import { updateUseCaseInContext, applyDesignContextMutation } from '@/features/agents/sub_use_cases/useCaseHelpers';
import { listTriggers, createTrigger, deleteTrigger } from '@/api/triggers';
import { listSubscriptions, createSubscription, deleteSubscription } from '@/api/events';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import type { UseCaseEventSubscription } from '@/features/shared/components/UseCasesList';

export function UseCaseSubscriptionsSection() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);

  const [dbTriggers, setDbTriggers] = useState<PersonaTrigger[]>([]);
  const [dbSubscriptions, setDbSubscriptions] = useState<PersonaEventSubscription[]>([]);

  const contextData = useMemo(
    () => parseDesignContext(selectedPersona?.design_context),
    [selectedPersona?.design_context],
  );
  const useCases = contextData.useCases ?? [];

  // Fetch DB-backed triggers and subscriptions.
  // A cancelled flag discards stale responses when personaId changes mid-flight.
  useEffect(() => {
    if (!selectedPersona) return;
    let cancelled = false;
    listTriggers(selectedPersona.id)
      .then((t) => { if (!cancelled) setDbTriggers(t); })
      .catch(() => {});
    listSubscriptions(selectedPersona.id)
      .then((s) => { if (!cancelled) setDbSubscriptions(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedPersona?.id]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activatingTriggers, setActivatingTriggers] = useState<Set<string>>(() => new Set());
  const [activatingSubscriptions, setActivatingSubscriptions] = useState<Set<string>>(() => new Set());
  const activatingTriggersRef = useRef(activatingTriggers);
  activatingTriggersRef.current = activatingTriggers;
  const activatingSubscriptionsRef = useRef(activatingSubscriptions);
  activatingSubscriptionsRef.current = activatingSubscriptions;

  const handleSubscriptionsChange = useCallback(
    (useCaseId: string, subs: UseCaseEventSubscription[]) => {
      if (!selectedPersona) return;
      void applyDesignContextMutation(selectedPersona.id, (ctx) =>
        updateUseCaseInContext(ctx, useCaseId, (uc) => ({
          ...uc,
          event_subscriptions: subs.length > 0 ? subs : undefined,
        })),
      );
    },
    [selectedPersona],
  );

  const handleActivateTrigger = useCallback(
    async (useCaseId: string, triggerType: string, config?: Record<string, unknown>) => {
      if (!selectedPersona) return;
      const key = `${useCaseId}:${triggerType}`;
      if (activatingTriggersRef.current.has(key)) return;
      setActivatingTriggers((prev) => new Set(prev).add(key));
      try {
        const created = await createTrigger({
          persona_id: selectedPersona.id,
          trigger_type: triggerType,
          config: config ? JSON.stringify(config) : null,
          enabled: true,
          use_case_id: useCaseId,
        });
        setDbTriggers((prev) => [...prev, created]);
      } catch (e) {
        console.error('Failed to create trigger:', e);
      } finally {
        setActivatingTriggers((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [selectedPersona],
  );

  const handleDeleteTrigger = useCallback(async (triggerId: string) => {
    try {
      await deleteTrigger(triggerId);
      setDbTriggers((prev) => prev.filter((t) => t.id !== triggerId));
    } catch (e) {
      console.error('Failed to delete trigger:', e);
    }
  }, []);

  const handleActivateSubscription = useCallback(
    async (useCaseId: string, eventType: string, sourceFilter?: string) => {
      if (!selectedPersona) return;
      const key = `${useCaseId}:${eventType}:${sourceFilter ?? ''}`;
      if (activatingSubscriptionsRef.current.has(key)) return;
      setActivatingSubscriptions((prev) => new Set(prev).add(key));
      try {
        const created = await createSubscription({
          persona_id: selectedPersona.id,
          event_type: eventType,
          source_filter: sourceFilter ?? null,
          enabled: true,
          use_case_id: useCaseId,
        });
        setDbSubscriptions((prev) => [...prev, created]);
      } catch (e) {
        console.error('Failed to create subscription:', e);
      } finally {
        setActivatingSubscriptions((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [selectedPersona],
  );

  const handleDeleteSubscription = useCallback(async (subId: string) => {
    try {
      await deleteSubscription(subId);
      setDbSubscriptions((prev) => prev.filter((s) => s.id !== subId));
    } catch (e) {
      console.error('Failed to delete subscription:', e);
    }
  }, []);

  if (useCases.length === 0) return null;

  const totalSuggestedSubs = useCases.reduce((sum, uc) => sum + (uc.event_subscriptions?.length ?? 0), 0);
  const totalDbTriggers = dbTriggers.length;
  const totalDbSubs = dbSubscriptions.length;
  const totalActive = totalDbTriggers + totalDbSubs;

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<Radio className="w-3.5 h-3.5" />}
        label="Triggers & Subscriptions"
        badge={(
          <>
            {totalActive > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                {totalActive} active
              </span>
            )}
            {totalSuggestedSubs > 0 && totalActive === 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                {totalSuggestedSubs} suggested
              </span>
            )}
          </>
        )}
      />

      <div className="space-y-2">
        {useCases.map((uc) => {
          const ucTriggers = dbTriggers.filter((t) => t.use_case_id === uc.id);
          const ucSubs = dbSubscriptions.filter((s) => s.use_case_id === uc.id);
          const suggestedSubCount = uc.event_subscriptions?.length ?? 0;
          const activeCount = ucTriggers.length + ucSubs.length;
          const isExpanded = expandedId === uc.id;

          return (
            <SectionCard key={uc.id} size="md" className="overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : uc.id)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-secondary/30 transition-colors"
              >
                <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                <span className="text-sm font-medium text-foreground/80 flex-1 truncate">{uc.title}</span>
                {activeCount > 0 && (
                  <span className="text-xs text-cyan-400/70">{activeCount} active</span>
                )}
                {activeCount === 0 && suggestedSubCount > 0 && (
                  <span className="text-xs text-amber-400/70">{suggestedSubCount} suggested</span>
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-primary/10 p-3.5">
                  <UseCaseSubscriptions
                    subscriptions={uc.event_subscriptions ?? []}
                    onChange={(subs) => handleSubscriptionsChange(uc.id, subs)}
                    dbTriggers={ucTriggers}
                    dbSubscriptions={ucSubs}
                    suggestedTrigger={uc.suggested_trigger}
                    useCaseId={uc.id}
                    onActivateTrigger={handleActivateTrigger}
                    onDeleteTrigger={handleDeleteTrigger}
                    onActivateSubscription={handleActivateSubscription}
                    onDeleteSubscription={handleDeleteSubscription}
                    activatingTriggers={activatingTriggers}
                    activatingSubscriptions={activatingSubscriptions}
                  />
                </div>
              )}
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
