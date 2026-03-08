import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import { mutateSingleUseCase } from '@/hooks/design/useDesignContextMutator';
import { listTriggers, createTrigger, deleteTrigger } from '@/api/triggers';
import { listSubscriptions, createSubscription, deleteSubscription } from '@/api/events';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import type { UseCaseEventSubscription, DesignUseCase } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails } from '@/lib/types/types';

// ── Lifecycle stages ────────────────────────────────────────────────

export type SubscriptionStage = 'suggested' | 'activated' | 'paused' | 'retired';

/**
 * Unified subscription record that merges JSON-backed suggestions
 * and DB-backed records into a single pipeline view.
 */
export interface UnifiedSubscription {
  /** Stable key for React lists: `trigger:<dbId>`, `sub:<dbId>`, or `suggested:<useCaseId>:<eventType>` */
  key: string;
  kind: 'trigger' | 'event_subscription';
  stage: SubscriptionStage;
  useCaseId: string;
  useCaseTitle: string;

  // Trigger fields
  triggerType?: string;
  triggerConfig?: string | null;
  triggerCron?: string;
  triggerDescription?: string;

  // Subscription fields
  eventType?: string;
  sourceFilter?: string;

  // DB record references (present when stage is activated/paused/retired)
  dbTriggerId?: string;
  dbSubscriptionId?: string;

  /** Index into the JSON event_subscriptions array (for suggested subs) */
  suggestedIndex?: number;
}

// ── Stage derivation ────────────────────────────────────────────────

function deriveTriggerStage(trigger: PersonaTrigger): SubscriptionStage {
  return trigger.enabled ? 'activated' : 'paused';
}

function deriveSubscriptionStage(sub: PersonaEventSubscription): SubscriptionStage {
  return sub.enabled ? 'activated' : 'paused';
}

// ── Merge logic ─────────────────────────────────────────────────────

function mergeSubscriptions(
  useCases: DesignUseCase[],
  dbTriggers: PersonaTrigger[],
  dbSubscriptions: PersonaEventSubscription[],
): UnifiedSubscription[] {
  const items: UnifiedSubscription[] = [];

  // Index DB records by use_case_id for fast lookup
  const triggersByUc = new Map<string, PersonaTrigger[]>();
  for (const t of dbTriggers) {
    const key = t.use_case_id ?? '__global__';
    const arr = triggersByUc.get(key) ?? [];
    arr.push(t);
    triggersByUc.set(key, arr);
  }

  const subsByUc = new Map<string, PersonaEventSubscription[]>();
  for (const s of dbSubscriptions) {
    const key = s.use_case_id ?? '__global__';
    const arr = subsByUc.get(key) ?? [];
    arr.push(s);
    subsByUc.set(key, arr);
  }

  for (const uc of useCases) {
    const ucTriggers = triggersByUc.get(uc.id) ?? [];
    const ucSubs = subsByUc.get(uc.id) ?? [];

    // DB-backed triggers
    for (const t of ucTriggers) {
      items.push({
        key: `trigger:${t.id}`,
        kind: 'trigger',
        stage: deriveTriggerStage(t),
        useCaseId: uc.id,
        useCaseTitle: uc.title,
        triggerType: t.trigger_type,
        triggerConfig: t.config,
        dbTriggerId: t.id,
      });
    }

    // DB-backed subscriptions
    for (const s of ucSubs) {
      items.push({
        key: `sub:${s.id}`,
        kind: 'event_subscription',
        stage: deriveSubscriptionStage(s),
        useCaseId: uc.id,
        useCaseTitle: uc.title,
        eventType: s.event_type,
        sourceFilter: s.source_filter ?? undefined,
        dbSubscriptionId: s.id,
      });
    }

    // Suggested trigger (JSON-backed) — only if no DB trigger of same type exists
    if (uc.suggested_trigger) {
      const alreadyActivated = ucTriggers.some((t) => t.trigger_type === uc.suggested_trigger!.type);
      if (!alreadyActivated) {
        items.push({
          key: `suggested-trigger:${uc.id}:${uc.suggested_trigger.type}`,
          kind: 'trigger',
          stage: 'suggested',
          useCaseId: uc.id,
          useCaseTitle: uc.title,
          triggerType: uc.suggested_trigger.type,
          triggerCron: uc.suggested_trigger.cron,
          triggerDescription: uc.suggested_trigger.description,
        });
      }
    }

    // Suggested event subscriptions (JSON-backed) — only if not already activated in DB
    const suggestedSubs = uc.event_subscriptions ?? [];
    for (let i = 0; i < suggestedSubs.length; i++) {
      const ss = suggestedSubs[i]!;
      const alreadyActivated = ucSubs.some(
        (s) => s.event_type === ss.event_type && (s.source_filter ?? '') === (ss.source_filter ?? ''),
      );
      if (!alreadyActivated) {
        items.push({
          key: `suggested:${uc.id}:${ss.event_type}:${ss.source_filter ?? ''}`,
          kind: 'event_subscription',
          stage: ss.enabled ? 'suggested' : 'retired',
          useCaseId: uc.id,
          useCaseTitle: uc.title,
          eventType: ss.event_type,
          sourceFilter: ss.source_filter,
          suggestedIndex: i,
        });
      }
    }
  }

  return items;
}

// ── Hook: useSubscriptionManager ────────────────────────────────────

export interface SubscriptionManagerState {
  items: UnifiedSubscription[];
  /** Items grouped by use case */
  byUseCase: Map<string, UnifiedSubscription[]>;
  /** Counts */
  totalSuggested: number;
  totalActive: number;
  /** Error message from last failed operation */
  error: string | null;
  /** Keys currently in-flight for activation */
  activating: Set<string>;
}

export interface SubscriptionManagerActions {
  /** Promote a suggested subscription/trigger to activated (DB-backed) */
  activate: (item: UnifiedSubscription, config?: Record<string, unknown>) => Promise<void>;
  /** Retire (delete from DB) an activated subscription/trigger */
  retire: (item: UnifiedSubscription) => Promise<void>;
  /** Add a new suggested subscription to a use case's JSON */
  addSuggested: (useCaseId: string, sub: UseCaseEventSubscription) => void;
  /** Remove a suggested subscription from a use case's JSON */
  removeSuggested: (useCaseId: string, index: number) => void;
  /** Toggle a suggested subscription's enabled flag in JSON */
  toggleSuggested: (useCaseId: string, index: number) => void;
  /** Update the full set of suggested subscriptions for a use case */
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
  const [activating, setActivating] = useState<Set<string>>(() => new Set());
  const activatingRef = useRef(activating);
  activatingRef.current = activating;

  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  // Parse use cases from design_context
  const useCases = useMemo(
    () => parseDesignContext(persona?.design_context).useCases ?? [],
    [persona?.design_context],
  );

  // Fetch DB records when persona changes
  useEffect(() => {
    setDbTriggers([]);
    setDbSubscriptions([]);
    setError(null);
    if (!persona) return;
    let cancelled = false;
    listTriggers(persona.id)
      .then((t) => { if (!cancelled) setDbTriggers(t); })
      .catch(() => {});
    listSubscriptions(persona.id)
      .then((s) => { if (!cancelled) setDbSubscriptions(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [persona?.id]);

  // Cleanup abort controllers on persona change and unmount
  useEffect(() => {
    return () => {
      controllersRef.current.forEach((c) => c.abort());
      controllersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
    setActivating(new Set());
  }, [persona?.id]);

  // Merge into unified view
  const items = useMemo(
    () => mergeSubscriptions(useCases, dbTriggers, dbSubscriptions),
    [useCases, dbTriggers, dbSubscriptions],
  );

  const byUseCase = useMemo(() => {
    const map = new Map<string, UnifiedSubscription[]>();
    for (const item of items) {
      const arr = map.get(item.useCaseId) ?? [];
      arr.push(item);
      map.set(item.useCaseId, arr);
    }
    return map;
  }, [items]);

  const totalSuggested = useMemo(
    () => items.filter((i) => i.stage === 'suggested').length,
    [items],
  );

  const totalActive = useMemo(
    () => items.filter((i) => i.stage === 'activated').length,
    [items],
  );

  // ── Actions ───────────────────────────────────────────────────────

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
          persona_id: personaIdAtStart,
          trigger_type: item.triggerType!,
          config: config ? JSON.stringify(config) : (item.triggerCron ? JSON.stringify({ cron: item.triggerCron }) : null),
          enabled: true,
          use_case_id: item.useCaseId,
        });
        if (controller.signal.aborted || personaIdRef.current !== personaIdAtStart) return;
        setDbTriggers((prev) => [...prev, created]);
      } else {
        const created = await createSubscription({
          persona_id: personaIdAtStart,
          event_type: item.eventType!,
          source_filter: item.sourceFilter ?? null,
          enabled: true,
          use_case_id: item.useCaseId,
        });
        if (controller.signal.aborted || personaIdRef.current !== personaIdAtStart) return;
        setDbSubscriptions((prev) => [...prev, created]);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error('Failed to activate subscription:', e);
      setError(`Failed to activate ${item.kind === 'trigger' ? 'trigger' : 'subscription'}`);
    } finally {
      controllersRef.current.delete(item.key);
    }
    if (controller.signal.aborted || personaIdRef.current !== personaIdAtStart) return;
    setActivating((prev) => {
      const next = new Set(prev);
      next.delete(item.key);
      return next;
    });
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
        if (!deleted) {
          setError('Delete failed. Subscription may still exist.');
          return;
        }
        setDbSubscriptions((prev) => prev.filter((s) => s.id !== item.dbSubscriptionId));
      }
    } catch (e) {
      console.error('Failed to retire subscription:', e);
      setError(`Failed to delete ${item.kind === 'trigger' ? 'trigger' : 'subscription'}`);
    }
  }, [persona]);

  const addSuggested = useCallback((useCaseId: string, sub: UseCaseEventSubscription) => {
    if (!persona) return;
    void mutateSingleUseCase(persona.id, useCaseId, (uc) => ({
      ...uc,
      event_subscriptions: [...(uc.event_subscriptions ?? []), sub],
    }));
  }, [persona]);

  const removeSuggested = useCallback((useCaseId: string, index: number) => {
    if (!persona) return;
    void mutateSingleUseCase(persona.id, useCaseId, (uc) => ({
      ...uc,
      event_subscriptions: (uc.event_subscriptions ?? []).filter((_, i) => i !== index),
    }));
  }, [persona]);

  const toggleSuggested = useCallback((useCaseId: string, index: number) => {
    if (!persona) return;
    void mutateSingleUseCase(persona.id, useCaseId, (uc) => ({
      ...uc,
      event_subscriptions: (uc.event_subscriptions ?? []).map((s, i) =>
        i === index ? { ...s, enabled: !s.enabled } : s,
      ),
    }));
  }, [persona]);

  const updateSuggested = useCallback((useCaseId: string, subs: UseCaseEventSubscription[]) => {
    if (!persona) return;
    void mutateSingleUseCase(persona.id, useCaseId, (uc) => ({
      ...uc,
      event_subscriptions: subs.length > 0 ? subs : undefined,
    }));
  }, [persona]);

  return {
    items,
    byUseCase,
    totalSuggested,
    totalActive,
    error,
    activating,
    activate,
    retire,
    addSuggested,
    removeSuggested,
    toggleSuggested,
    updateSuggested,
  };
}
