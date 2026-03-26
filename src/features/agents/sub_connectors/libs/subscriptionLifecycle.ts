import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { parseDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import { createLogger } from "@/lib/log";

const logger = createLogger("subscription-lifecycle");
import { mutateSingleUseCase } from '@/hooks/design/core/useDesignContextMutator';
import { listTriggers, createTrigger, deleteTrigger } from '@/api/pipeline/triggers';
import { listSubscriptions, createSubscription, deleteSubscription } from '@/api/overview/events';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import type { UseCaseEventSubscription } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails } from '@/lib/types/types';
import { mergeSubscriptions } from './subscriptionHelpers';
import type { UnifiedSubscription } from './subscriptionHelpers';

export type { SubscriptionStage, UnifiedSubscription } from './subscriptionHelpers';

export interface SubscriptionManagerState {
  items: UnifiedSubscription[];
  byUseCase: Map<string, UnifiedSubscription[]>;
  totalSuggested: number;
  totalActive: number;
  error: string | null;
  activating: Set<string>;
  /** True while the initial load is in progress */
  loading: boolean;
  /** Retry the initial data load */
  retryLoad: () => void;
}

export interface SubscriptionManagerActions {
  activate: (item: UnifiedSubscription, config?: Record<string, unknown>) => Promise<void>;
  retire: (item: UnifiedSubscription) => Promise<void>;
  addSuggested: (useCaseId: string, sub: UseCaseEventSubscription) => void;
  removeSuggested: (useCaseId: string, index: number) => void;
  toggleSuggested: (useCaseId: string, index: number) => void;
  updateSuggested: (useCaseId: string, subs: UseCaseEventSubscription[]) => void;
}

export function useSubscriptionManager(
  persona: PersonaWithDetails | null,
): SubscriptionManagerState & SubscriptionManagerActions {
  const personaIdRef = useRef<string | null>(persona?.id ?? null);
  useEffect(() => { personaIdRef.current = persona?.id ?? null; }, [persona?.id]);

  const [dbTriggers, setDbTriggers] = useState<PersonaTrigger[]>([]);
  const [dbSubscriptions, setDbSubscriptions] = useState<PersonaEventSubscription[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadEpoch, setLoadEpoch] = useState(0);
  const [activating, setActivating] = useState<Set<string>>(() => new Set());
  const activatingRef = useRef(activating);
  activatingRef.current = activating;
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const useCases = useMemo(
    () => parseDesignContext(persona?.design_context).useCases ?? [],
    [persona?.design_context],
  );

  const retryLoad = useCallback(() => setLoadEpoch((e) => e + 1), []);

  useEffect(() => {
    setDbTriggers([]); setDbSubscriptions([]); setError(null);
    if (!persona) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const loadTriggers = listTriggers(persona.id)
      .then((t) => { if (!cancelled) setDbTriggers(t); })
      .catch((e) => { if (!cancelled) setError((prev) => prev ?? `Failed to load triggers: ${e instanceof Error ? e.message : 'unknown error'}`); });

    const loadSubs = listSubscriptions(persona.id)
      .then((s) => { if (!cancelled) setDbSubscriptions(s); })
      .catch((e) => { if (!cancelled) setError((prev) => prev ?? `Failed to load subscriptions: ${e instanceof Error ? e.message : 'unknown error'}`); });

    Promise.allSettled([loadTriggers, loadSubs]).then(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [persona?.id, loadEpoch]);

  useEffect(() => {
    return () => { controllersRef.current.forEach((c) => c.abort()); controllersRef.current.clear(); };
  }, []);

  useEffect(() => {
    controllersRef.current.forEach((c) => c.abort()); controllersRef.current.clear();
    setActivating(new Set());
  }, [persona?.id]);

  const items = useMemo(() => mergeSubscriptions(useCases, dbTriggers, dbSubscriptions), [useCases, dbTriggers, dbSubscriptions]);

  const byUseCase = useMemo(() => {
    const map = new Map<string, UnifiedSubscription[]>();
    for (const item of items) { const arr = map.get(item.useCaseId) ?? []; arr.push(item); map.set(item.useCaseId, arr); }
    return map;
  }, [items]);

  const totalSuggested = useMemo(() => items.filter((i) => i.stage === 'suggested').length, [items]);
  const totalActive = useMemo(() => items.filter((i) => i.stage === 'activated').length, [items]);

  const activate = useCallback(async (item: UnifiedSubscription, config?: Record<string, unknown>) => {
    if (!persona) return;
    const personaIdAtStart = persona.id;
    if (activatingRef.current.has(item.key)) return;
    const controller = new AbortController();
    controllersRef.current.set(item.key, controller);
    setActivating((prev) => new Set(prev).add(item.key));
    try {
      if (item.kind === 'trigger') {
        const created = await createTrigger({
          persona_id: personaIdAtStart, trigger_type: item.triggerType!,
          config: config ? JSON.stringify(config) : (item.triggerCron ? JSON.stringify({ cron: item.triggerCron }) : null),
          enabled: true, use_case_id: item.useCaseId,
        });
        if (controller.signal.aborted || personaIdRef.current !== personaIdAtStart) return;
        setDbTriggers((prev) => [...prev, created]);
      } else {
        const created = await createSubscription({
          persona_id: personaIdAtStart, event_type: item.eventType!,
          source_filter: item.sourceFilter ?? null, enabled: true, use_case_id: item.useCaseId,
        });
        if (controller.signal.aborted || personaIdRef.current !== personaIdAtStart) return;
        setDbSubscriptions((prev) => [...prev, created]);
        // Mark the JSON suggestion as adopted so it never resurfaces.
        if (item.suggestedIndex != null) {
          void mutateSingleUseCase(personaIdAtStart, item.useCaseId, (uc) => ({
            ...uc,
            event_subscriptions: (uc.event_subscriptions ?? []).map((s, i) =>
              i === item.suggestedIndex ? { ...s, adopted: true } : s,
            ),
          }));
        }
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      logger.error('Failed to activate subscription', { error: e });
      setError(`Failed to activate ${item.kind === 'trigger' ? 'trigger' : 'subscription'}`);
    } finally {
      controllersRef.current.delete(item.key);
      setActivating((prev) => { const next = new Set(prev); next.delete(item.key); return next; });
    }
  }, [persona]);

  const retire = useCallback(async (item: UnifiedSubscription) => {
    if (!persona) return;
    setError(null);
    try {
      if (item.kind === 'trigger' && item.dbTriggerId) {
        await deleteTrigger(item.dbTriggerId, persona.id);
        setDbTriggers((prev) => prev.filter((t) => t.id !== item.dbTriggerId));
      } else if (item.dbSubscriptionId) {
        const deleted = await deleteSubscription(item.dbSubscriptionId);
        if (!deleted) { setError('Delete failed. Subscription may still exist.'); return; }
        setDbSubscriptions((prev) => prev.filter((s) => s.id !== item.dbSubscriptionId));
      }
    } catch (e) {
      logger.error('Failed to retire subscription', { error: e });
      setError(`Failed to delete ${item.kind === 'trigger' ? 'trigger' : 'subscription'}`);
    }
  }, [persona]);

  const addSuggested = useCallback((useCaseId: string, sub: UseCaseEventSubscription) => {
    if (!persona) return;
    void mutateSingleUseCase(persona.id, useCaseId, (uc) => ({ ...uc, event_subscriptions: [...(uc.event_subscriptions ?? []), sub] }));
  }, [persona]);

  const removeSuggested = useCallback((useCaseId: string, index: number) => {
    if (!persona) return;
    void mutateSingleUseCase(persona.id, useCaseId, (uc) => ({ ...uc, event_subscriptions: (uc.event_subscriptions ?? []).filter((_, i) => i !== index) }));
  }, [persona]);

  const toggleSuggested = useCallback((useCaseId: string, index: number) => {
    if (!persona) return;
    void mutateSingleUseCase(persona.id, useCaseId, (uc) => ({
      ...uc, event_subscriptions: (uc.event_subscriptions ?? []).map((s, i) => i === index ? { ...s, enabled: !s.enabled } : s),
    }));
  }, [persona]);

  const updateSuggested = useCallback((useCaseId: string, subs: UseCaseEventSubscription[]) => {
    if (!persona) return;
    void mutateSingleUseCase(persona.id, useCaseId, (uc) => ({ ...uc, event_subscriptions: subs.length > 0 ? subs : undefined }));
  }, [persona]);

  return {
    items, byUseCase, totalSuggested, totalActive, error, activating, loading, retryLoad,
    activate, retire, addSuggested, removeSuggested, toggleSuggested, updateSuggested,
  };
}
