import { useAgentStore } from '@/stores/agentStore';
import { useShallow } from 'zustand/react/shallow';

const EMPTY: string[] = [];

/**
 * Shared hook for consuming execution output for a given persona.
 * Replaces the duplicated pattern of subscribing to executionOutput,
 * checking persona ownership, and filtering by line classification.
 *
 * Used by both ChatTab (for streaming bubbles) and PersonaRunner (for terminal).
 *
 * textLines is executionTextLines, maintained incrementally by executionSink
 * (see executionSink.ts) -- this hook no longer re-filters/re-classifies the
 * whole buffer on every flush.
 */
export function useExecutionStream(personaId: string) {
  const { executionOutput, executionTextLines, executionPersonaId, isExecuting } = useAgentStore(
    useShallow((s) => ({
      executionOutput: s.executionOutput,
      executionTextLines: s.executionTextLines,
      executionPersonaId: s.executionPersonaId,
      isExecuting: s.isExecuting,
    })),
  );

  const isOwner = executionPersonaId === personaId && personaId !== '';
  const lines = isOwner ? executionOutput : EMPTY;
  const textLines = isOwner ? executionTextLines : EMPTY;

  return { lines, textLines, isOwner, isRunning: isExecuting && isOwner };
}
