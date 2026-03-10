import { createTrigger } from '@/api/pipeline/triggers';
import { createSubscription } from '@/api/overview/events';
import type { PartialPersonaUpdate } from '@/api/agents/personas';
import type { AgentIR } from '@/lib/types/designTypes';

export interface ApplyDesignSelections {
  selectedTools?: Set<string>;
  selectedTriggerIndices?: Set<number>;
  selectedChannelIndices?: Set<number>;
  selectedSubscriptionIndices?: Set<number>;
}

export interface ApplyDesignDeps {
  applyPersonaOp: (personaId: string, op: { kind: 'ApplyDesignResult'; updates: PartialPersonaUpdate }) => Promise<void>;
  refreshPersonas: () => Promise<void>;
}

export interface FailedTriggerOp {
  kind: 'trigger';
  index: number;
  label: string;
  trigger: AgentIR['suggested_triggers'][number];
  error: string;
}

export interface FailedSubscriptionOp {
  kind: 'subscription';
  index: number;
  label: string;
  subscription: NonNullable<AgentIR['suggested_event_subscriptions']>[number];
  error: string;
}

export type FailedOperation = FailedTriggerOp | FailedSubscriptionOp;

export interface ApplyDesignOutcome {
  warnings: string[];
  failedOperations: FailedOperation[];
}

/**
 * Standalone business transaction that persists a design analysis result
 * to a persona. Handles:
 * - Filtering selections (tools, triggers, channels, subscriptions)
 * - Updating persona fields (prompt, structured_prompt, design result)
 * - Creating triggers in a loop
 * - Creating event subscriptions in a loop
 * - Collecting warnings for partial failures
 * - Refreshing the store
 *
 * Decoupled from streaming infrastructure so it can be reused from
 * non-streaming contexts (template adoption, import, batch operations).
 */
export async function applyDesignResult(
  personaId: string,
  result: AgentIR,
  deps: ApplyDesignDeps,
  selections?: ApplyDesignSelections,
): Promise<ApplyDesignOutcome> {
  const filteredResult: AgentIR = {
    ...result,
    suggested_tools: selections?.selectedTools
      ? result.suggested_tools.filter((t) => selections.selectedTools!.has(t))
      : result.suggested_tools,
    suggested_triggers: selections?.selectedTriggerIndices
      ? result.suggested_triggers.filter((_, i) => selections.selectedTriggerIndices!.has(i))
      : result.suggested_triggers,
    suggested_notification_channels: selections?.selectedChannelIndices
      ? (result.suggested_notification_channels ?? []).filter((_, i) => selections.selectedChannelIndices!.has(i))
      : result.suggested_notification_channels,
    suggested_event_subscriptions: selections?.selectedSubscriptionIndices
      ? (result.suggested_event_subscriptions ?? []).filter((_, i) => selections.selectedSubscriptionIndices!.has(i))
      : result.suggested_event_subscriptions,
  };

  const updates: PartialPersonaUpdate = {
    last_design_result: JSON.stringify(filteredResult),
  };

  if (filteredResult.structured_prompt) {
    updates.structured_prompt = JSON.stringify(filteredResult.structured_prompt);
  }
  if (filteredResult.full_prompt_markdown) {
    updates.system_prompt = filteredResult.full_prompt_markdown;
  }

  await deps.applyPersonaOp(personaId, { kind: 'ApplyDesignResult', updates });

  const warnings: string[] = [];
  const failedOperations: FailedOperation[] = [];

  for (const [i, trigger] of filteredResult.suggested_triggers.entries()) {
    try {
      await createTrigger({
        persona_id: personaId,
        trigger_type: trigger.trigger_type,
        config: trigger.config ? JSON.stringify(trigger.config) : null,
        enabled: true,
        use_case_id: null,
      });
    } catch (err) {
      const label = trigger.description || `${trigger.trigger_type} trigger`;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      warnings.push(`Trigger "${label}" failed to create`);
      failedOperations.push({ kind: 'trigger', index: i, label, trigger, error: errorMsg });
    }
  }

  for (const [i, sub] of (filteredResult.suggested_event_subscriptions ?? []).entries()) {
    try {
      await createSubscription({
        persona_id: personaId,
        event_type: sub.event_type,
        source_filter: sub.source_filter ? JSON.stringify(sub.source_filter) : null,
        enabled: true,
        use_case_id: null,
      });
    } catch (err) {
      const label = sub.description || `${sub.event_type} subscription`;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      warnings.push(`Subscription "${label}" failed to create`);
      failedOperations.push({ kind: 'subscription', index: i, label, subscription: sub, error: errorMsg });
    }
  }

  await deps.refreshPersonas();

  return { warnings, failedOperations };
}

/**
 * Retry only the previously failed operations from an apply attempt.
 */
export async function retryFailedOperations(
  personaId: string,
  failedOps: FailedOperation[],
  deps: Pick<ApplyDesignDeps, 'refreshPersonas'>,
): Promise<ApplyDesignOutcome> {
  const warnings: string[] = [];
  const stillFailed: FailedOperation[] = [];

  for (const op of failedOps) {
    if (op.kind === 'trigger') {
      try {
        await createTrigger({
          persona_id: personaId,
          trigger_type: op.trigger.trigger_type,
          config: op.trigger.config ? JSON.stringify(op.trigger.config) : null,
          enabled: true,
          use_case_id: null,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`Trigger "${op.label}" failed to create`);
        stillFailed.push({ ...op, error: errorMsg });
      }
    } else {
      try {
        await createSubscription({
          persona_id: personaId,
          event_type: op.subscription.event_type,
          source_filter: op.subscription.source_filter ? JSON.stringify(op.subscription.source_filter) : null,
          enabled: true,
          use_case_id: null,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`Subscription "${op.label}" failed to create`);
        stillFailed.push({ ...op, error: errorMsg });
      }
    }
  }

  await deps.refreshPersonas();

  return { warnings, failedOperations: stillFailed };
}
