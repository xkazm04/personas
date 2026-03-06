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
  const selectedPersonaIdRef = useRef<string | null>(selectedPersona?.id ?? null);

  useEffect(() => {
    selectedPersonaIdRef.current = selectedPersona?.id ?? null;
  }, [selectedPersona?.id]);

  const [dbTriggers, setDbTriggers] = useState<PersonaTrigger[]>([]);
  const [dbSubscriptions, setDbSubscriptions] = useState<PersonaEventSubscription[]>([]);
  const [error, setError] = useState<string | null>(null);

  const contextData = useMemo(
    () => parseDesignContext(selectedPersona?.design_context),
    [selectedPersona?.design_context],
  );
  const useCases = contextData.useCases ?? [];

  // Fetch DB-backed triggers and subscriptions.
  // A cancelled flag discards stale responses when personaId changes mid-flight.
  useEffect(() => {
    setDbTriggers([]);
    setDbSubscriptions([]);
    setError(null);
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
  const triggerControllersRef = useRef<Map<string, AbortController>>(new Map());
  const subscriptionControllersRef = useRef<Map<string, AbortController>>(new Map());
  const activatingTriggersRef = useRef(activatingTriggers);
  activatingTriggersRef.current = activatingTriggers;
  const activatingSubscriptionsRef = useRef(activatingSubscriptions);
  activatingSubscriptionsRef.current = activatingSubscriptions;

  useEffect(() => {
    return () => {
      triggerControllersRef.current.forEach((controller) => controller.abort());
      triggerControllersRef.current.clear();
      subscriptionControllersRef.current.forEach((controller) => controller.abort());
      subscriptionControllersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    triggerControllersRef.current.forEach((controller) => controller.abort());
    triggerControllersRef.current.clear();
    subscriptionControllersRef.current.forEach((controller) => controller.abort());
    subscriptionControllersRef.current.clear();
    setActivatingTriggers(new Set());
    setActivatingSubscriptions(new Set());
  }, [selectedPersona?.id]);

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
      const personaIdAtStart = selectedPersona.id;
      const key = `${useCaseId}:${triggerType}`;
      if (activatingTriggersRef.current.has(key)) return;
      const controller = new AbortController();
      triggerControllersRef.current.set(key, controller);
      setActivatingTriggers((prev) => new Set(prev).add(key));
      try {
        const created = await createTrigger({
          persona_id: personaIdAtStart,
          trigger_type: triggerType,
          config: config ? JSON.stringify(config) : null,
          enabled: true,
          use_case_id: useCaseId,
        });
        if (controller.signal.aborted || selectedPersonaIdRef.current !== personaIdAtStart) return;
        setDbTriggers((prev) => [...prev, created]);
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error('Failed to create trigger:', e);
      } finally {
        triggerControllersRef.current.delete(key);
      }
      if (controller.signal.aborted || selectedPersonaIdRef.current !== personaIdAtStart) return;
      setActivatingTriggers((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [selectedPersona],
  );

  const handleDeleteTrigger = useCallback(async (triggerId: string) => {
    if (!selectedPersona) return;
    try {
      await deleteTrigger(triggerId, selectedPersona.id);
      setDbTriggers((prev) => prev.filter((t) => t.id !== triggerId));
    } catch (e) {
      console.error('Failed to delete trigger:', e);
    }
  }, [selectedPersona]);

  const handleActivateSubscription = useCallback(
    async (useCaseId: string, eventType: string, sourceFilter?: string) => {
      if (!selectedPersona) return;
      const personaIdAtStart = selectedPersona.id;
      const key = `${useCaseId}:${eventType}:${sourceFilter ?? ''}`;
      if (activatingSubscriptionsRef.current.has(key)) return;
      const controller = new AbortController();
      subscriptionControllersRef.current.set(key, controller);
      setActivatingSubscriptions((prev) => new Set(prev).add(key));
      try {
        const created = await createSubscription({
          persona_id: personaIdAtStart,
          event_type: eventType,
          source_filter: sourceFilter ?? null,
          enabled: true,
          use_case_id: useCaseId,
        });
        if (controller.signal.aborted || selectedPersonaIdRef.current !== personaIdAtStart) return;
        setDbSubscriptions((prev) => [...prev, created]);
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error('Failed to create subscription:', e);
      } finally {
        subscriptionControllersRef.current.delete(key);
      }
      if (controller.signal.aborted || selectedPersonaIdRef.current !== personaIdAtStart) return;
      setActivatingSubscriptions((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [selectedPersona],
  );

  const handleDeleteSubscription = useCallback(async (subId: string) => {
    try {
      setError(null);
      const deleted = await deleteSubscription(subId);
      if (!deleted) {
        setError('Delete failed. Subscription may still exist.');
        return;
      }
      setDbSubscriptions((prev) => prev.filter((s) => s.id !== subId));
    } catch (e) {
      setError('Failed to delete subscription');
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

      {error && (
        <div className="px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/10 text-sm text-red-400/80">
          {error}
        </div>
      )}

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
                aria-expanded={isExpanded}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-secondary/30 transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none focus-visible:rounded-xl"
              >
                <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                <span className="text-sm font-medium text-foreground/80 flex-1 truncate">{uc.title}</span>
                {activeCount > 0 && (
                  <span className="text-sm text-cyan-400/70">{activeCount} active</span>
                )}
                {activeCount === 0 && suggestedSubCount > 0 && (
                  <span className="text-sm text-amber-400/70">{suggestedSubCount} suggested</span>
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
