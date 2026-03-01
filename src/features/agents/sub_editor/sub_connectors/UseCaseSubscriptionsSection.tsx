import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, Radio } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import { UseCaseSubscriptions } from '@/features/agents/sub_editor/sub_use_cases/UseCaseSubscriptions';
import { updateUseCaseInContext, applyDesignContextMutation } from '@/features/agents/sub_editor/sub_use_cases/useCaseHelpers';
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

  // Fetch DB-backed triggers and subscriptions
  useEffect(() => {
    if (!selectedPersona) return;
    void listTriggers(selectedPersona.id).then(setDbTriggers).catch(() => {});
    void listSubscriptions(selectedPersona.id).then(setDbSubscriptions).catch(() => {});
  }, [selectedPersona?.id]);

  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      <div className="flex items-center gap-2 px-1">
        <Radio className="w-3.5 h-3.5 text-muted-foreground/80" />
        <p className="text-sm font-medium text-muted-foreground/80">
          Triggers & Subscriptions
        </p>
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
      </div>

      <div className="space-y-2">
        {useCases.map((uc) => {
          const ucTriggers = dbTriggers.filter((t) => t.use_case_id === uc.id);
          const ucSubs = dbSubscriptions.filter((s) => s.use_case_id === uc.id);
          const suggestedSubCount = uc.event_subscriptions?.length ?? 0;
          const activeCount = ucTriggers.length + ucSubs.length;
          const isExpanded = expandedId === uc.id;

          return (
            <div key={uc.id} className="bg-secondary/20 border border-primary/10 rounded-xl overflow-hidden">
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
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
