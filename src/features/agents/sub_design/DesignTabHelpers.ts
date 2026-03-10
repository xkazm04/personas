import type { AgentIR } from '@/lib/types/designTypes';
import type { PersonaWithDetails } from '@/lib/types/types';

/**
 * Build a human-readable change summary from the design result and user selections.
 */
export function buildChangeSummary(opts: {
  result: AgentIR | null;
  selectedTools: Set<string>;
  selectedTriggerIndices: Set<number>;
  selectedChannelIndices: Set<number>;
  selectedSubscriptionIndices: Set<number>;
  currentToolNames: string[];
  selectedPersona: PersonaWithDetails | null;
}): string[] {
  const {
    result,
    selectedTools,
    selectedTriggerIndices,
    selectedChannelIndices,
    selectedSubscriptionIndices,
    currentToolNames,
    selectedPersona,
  } = opts;

  if (!result) return [];
  const items: string[] = [];

  // System prompt change
  if (result.full_prompt_markdown) {
    const hasExisting = !!selectedPersona?.system_prompt?.trim();
    items.push(hasExisting ? 'Update system prompt' : 'Set system prompt');
  }

  // Tools
  const selectedToolCount = selectedTools.size;
  if (selectedToolCount > 0) {
    const newTools = [...selectedTools].filter((t) => !currentToolNames.includes(t));
    if (newTools.length > 0 && newTools.length < selectedToolCount) {
      items.push(`Add ${newTools.length} new tool${newTools.length !== 1 ? 's' : ''}, keep ${selectedToolCount - newTools.length} existing`);
    } else if (newTools.length === selectedToolCount) {
      items.push(`Add ${selectedToolCount} tool${selectedToolCount !== 1 ? 's' : ''}`);
    } else {
      items.push(`Keep ${selectedToolCount} tool${selectedToolCount !== 1 ? 's' : ''}`);
    }
  }

  // Triggers
  const triggerCount = selectedTriggerIndices.size;
  if (triggerCount > 0) {
    items.push(`Add ${triggerCount} trigger${triggerCount !== 1 ? 's' : ''}`);
  }

  // Notification channels
  const channelCount = selectedChannelIndices.size;
  if (channelCount > 0) {
    items.push(`Add ${channelCount} notification channel${channelCount !== 1 ? 's' : ''}`);
  }

  // Event subscriptions
  const subCount = selectedSubscriptionIndices.size;
  if (subCount > 0) {
    items.push(`Add ${subCount} event subscription${subCount !== 1 ? 's' : ''}`);
  }

  return items;
}

/** Build a Set containing every index in the provided array-like value. */
export function allIndices(items: unknown[] | null | undefined): Set<number> {
  return new Set((items ?? []).map((_, i) => i));
}
