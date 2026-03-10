import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import type { DesignUseCase } from '@/lib/types/frontendTypes';

// ── Subscription ownership lifecycle ────────────────────────────────
//
// JSON suggestions (design_context.useCases[].event_subscriptions) are
// *templates* that become DB subscriptions (PersonaEventSubscription) on
// activation. Once activated, the JSON entry is marked `adopted: true`
// so it never resurfaces — even if the DB record is later deleted.
//
//   JSON suggestion  ──activate──▶  DB record created  +  JSON marked adopted
//                                   (source of truth)
//
// The DB is the sole authority for active/paused subscriptions.
// JSON entries only serve as initial suggestions.

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

export function mergeSubscriptions(
  useCases: DesignUseCase[],
  dbTriggers: PersonaTrigger[],
  dbSubscriptions: PersonaEventSubscription[],
): UnifiedSubscription[] {
  const items: UnifiedSubscription[] = [];

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

    for (const t of ucTriggers) {
      items.push({
        key: `trigger:${t.id}`, kind: 'trigger', stage: deriveTriggerStage(t),
        useCaseId: uc.id, useCaseTitle: uc.title,
        triggerType: t.trigger_type, triggerConfig: t.config, dbTriggerId: t.id,
      });
    }

    for (const s of ucSubs) {
      items.push({
        key: `sub:${s.id}`, kind: 'event_subscription', stage: deriveSubscriptionStage(s),
        useCaseId: uc.id, useCaseTitle: uc.title,
        eventType: s.event_type, sourceFilter: s.source_filter ?? undefined, dbSubscriptionId: s.id,
      });
    }

    if (uc.suggested_trigger) {
      const alreadyActivated = ucTriggers.some((t) => t.trigger_type === uc.suggested_trigger!.type);
      if (!alreadyActivated) {
        items.push({
          key: `suggested-trigger:${uc.id}:${uc.suggested_trigger.type}`,
          kind: 'trigger', stage: 'suggested',
          useCaseId: uc.id, useCaseTitle: uc.title,
          triggerType: uc.suggested_trigger.type,
          triggerCron: uc.suggested_trigger.cron,
          triggerDescription: uc.suggested_trigger.description,
        });
      }
    }

    const suggestedSubs = uc.event_subscriptions ?? [];
    for (let i = 0; i < suggestedSubs.length; i++) {
      const ss = suggestedSubs[i]!;
      // Adopted suggestions have already been promoted to DB records and should
      // never resurface, even if the DB record is later deleted.
      if (ss.adopted) continue;
      const alreadyActivated = ucSubs.some(
        (s) => s.event_type === ss.event_type && (s.source_filter ?? '') === (ss.source_filter ?? ''),
      );
      if (!alreadyActivated) {
        items.push({
          key: `suggested:${uc.id}:${ss.event_type}:${ss.source_filter ?? ''}`,
          kind: 'event_subscription', stage: ss.enabled ? 'suggested' : 'retired',
          useCaseId: uc.id, useCaseTitle: uc.title,
          eventType: ss.event_type, sourceFilter: ss.source_filter,
          suggestedIndex: i,
        });
      }
    }
  }

  return items;
}
