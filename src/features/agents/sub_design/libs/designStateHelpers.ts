import { useMemo, useEffect, useCallback } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useToggleSet } from '@/hooks/utility/interaction/useToggleSet';
import type { AgentIR } from '@/lib/types/designTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { parseDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import { allIndices, buildChangeSummary } from '../DesignTabHelpers';
import type { DesignFilesSection } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails } from '@/lib/types/types';

/**
 * Parsed saved design result with Google connector fixup.
 */
export function useSavedDesignResult(selectedPersona: PersonaWithDetails | null) {
  return useMemo<AgentIR | null>(() => {
    const parsed = parseJsonOrDefault<AgentIR | null>(selectedPersona?.last_design_result, null);
    if (!parsed) return null;
    const GOOGLE_CONNECTORS = new Set(['gmail', 'google_calendar', 'google_drive']);
    parsed.suggested_connectors?.forEach((c) => {
      if (!c.oauth_type && GOOGLE_CONNECTORS.has(c.name)) {
        c.oauth_type = 'google';
      }
    });
    return parsed;
  }, [selectedPersona?.last_design_result]);
}

/**
 * Parse design context from persona on persona change.
 */
export function useDesignContextSync(
  selectedPersona: PersonaWithDetails | null,
  setDesignContext: (ctx: DesignFilesSection) => void,
) {
  useEffect(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    setDesignContext(ctx.designFiles ?? { files: [], references: [] });
  }, [selectedPersona?.id]);
}

/**
 * Selection state for tools, triggers, channels, subscriptions.
 */
export function useSelectionState() {
  const [selectedTools, handleToolToggle, setSelectedTools] = useToggleSet<string>();
  const [selectedTriggerIndices, handleTriggerToggle, setSelectedTriggerIndices] = useToggleSet<number>();
  const [selectedChannelIndices, handleChannelToggle, setSelectedChannelIndices] = useToggleSet<number>();
  const [selectedSubscriptionIndices, handleSubscriptionToggle, setSelectedSubscriptionIndices] = useToggleSet<number>();

  const clearSelections = useCallback(() => {
    setSelectedTools(new Set());
    setSelectedTriggerIndices(new Set());
    setSelectedChannelIndices(new Set());
    setSelectedSubscriptionIndices(new Set());
  }, [setSelectedTools, setSelectedTriggerIndices, setSelectedChannelIndices, setSelectedSubscriptionIndices]);

  return {
    selectedTools, handleToolToggle, setSelectedTools,
    selectedTriggerIndices, handleTriggerToggle, setSelectedTriggerIndices,
    selectedChannelIndices, handleChannelToggle, setSelectedChannelIndices,
    selectedSubscriptionIndices, handleSubscriptionToggle, setSelectedSubscriptionIndices,
    clearSelections,
  };
}

/**
 * Sync selections when result changes.
 */
export function useResultSelectionSync(
  result: AgentIR | null,
  setSelectedTools: (v: Set<string>) => void,
  setSelectedTriggerIndices: (v: Set<number>) => void,
  setSelectedChannelIndices: (v: Set<number>) => void,
  setSelectedSubscriptionIndices: (v: Set<number>) => void,
) {
  const resultId = result ? `${result.summary}-${result.suggested_tools.length}` : null;
  useEffect(() => {
    if (result) {
      setSelectedTools(new Set(result.suggested_tools));
      setSelectedTriggerIndices(allIndices(result.suggested_triggers));
      setSelectedChannelIndices(allIndices(result.suggested_notification_channels));
      if (result.suggested_event_subscriptions?.length) {
        setSelectedSubscriptionIndices(allIndices(result.suggested_event_subscriptions));
      }
    }
  }, [resultId]);
}

/**
 * Build the change summary for the current state.
 */
export function useChangeSummary(
  result: AgentIR | null,
  selectedTools: Set<string>,
  selectedTriggerIndices: Set<number>,
  selectedChannelIndices: Set<number>,
  selectedSubscriptionIndices: Set<number>,
  selectedPersona: PersonaWithDetails | null,
) {
  const currentToolNames = useMemo(
    () => (selectedPersona?.tools || []).map((t) => t.name),
    [selectedPersona],
  );

  const changeSummary = useMemo(
    () => buildChangeSummary({
      result, selectedTools, selectedTriggerIndices, selectedChannelIndices,
      selectedSubscriptionIndices, currentToolNames, selectedPersona,
    }),
    [result, selectedTools, selectedTriggerIndices, selectedChannelIndices, selectedSubscriptionIndices, currentToolNames, selectedPersona],
  );

  return { currentToolNames, changeSummary };
}

/**
 * Drift events filtered for current persona.
 */
export function useDriftEventsForPersona(personaId: string | undefined) {
  const allDriftEvents = useAgentStore((s) => s.designDriftEvents);
  const dismissDriftEvent = useAgentStore((s) => s.dismissDriftEvent);
  const driftEvents = useMemo(
    () => allDriftEvents.filter((e) => e.personaId === personaId),
    [allDriftEvents, personaId],
  );
  return { driftEvents, dismissDriftEvent };
}
