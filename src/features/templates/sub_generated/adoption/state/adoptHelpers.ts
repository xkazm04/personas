import type { AgentIR } from '@/lib/types/designTypes';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { getAdoptionRequirements, getDefaultValues } from '../templateVariables';

export function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function initSelectionsFromDesignResult(design: AgentIR) {
  const selectedToolIndices = new Set<number>(
    design.suggested_tools.map((_, i) => i),
  );
  const selectedTriggerIndices = new Set<number>(
    design.suggested_triggers.map((_, i) => i),
  );
  const selectedConnectorNames = new Set<string>(
    (design.suggested_connectors ?? []).map((c) => c.name),
  );
  const selectedChannelIndices = new Set<number>(
    (design.suggested_notification_channels ?? []).map((_, i) => i),
  );
  const selectedEventIndices = new Set<number>(
    (design.suggested_event_subscriptions ?? []).map((_, i) => i),
  );
  const selectedUseCaseIds = new Set<string>();

  const variableValues = getDefaultValues(getAdoptionRequirements(design));

  return {
    selectedUseCaseIds,
    selectedToolIndices,
    selectedTriggerIndices,
    selectedConnectorNames,
    selectedChannelIndices,
    selectedEventIndices,
    variableValues,
  };
}

export function prefillDefaults(questions: TransformQuestionResponse[]): Record<string, string> {
  return questions.reduce<Record<string, string>>((acc, q) => {
    if (q.default) acc[q.id] = q.default;
    return acc;
  }, {});
}
