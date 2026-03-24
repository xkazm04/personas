import { useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { classifyLine } from '@/lib/utils/terminalColors';

const EMPTY: string[] = [];

/**
 * Shared hook for consuming execution output for a given persona.
 * Replaces the duplicated pattern of subscribing to executionOutput,
 * checking persona ownership, and filtering by line classification.
 *
 * Used by both ChatTab (for streaming bubbles) and PersonaRunner (for terminal).
 */
export function useExecutionStream(personaId: string) {
  const executionOutput = useAgentStore((s) => s.executionOutput);
  const executionPersonaId = useAgentStore((s) => s.executionPersonaId);
  const isExecuting = useAgentStore((s) => s.isExecuting);

  const isOwner = executionPersonaId === personaId && personaId !== '';
  const lines = isOwner ? executionOutput : EMPTY;

  const textLines = useMemo(() => {
    if (!isOwner || executionOutput.length === 0) return EMPTY;
    return executionOutput.filter((l) => classifyLine(l) === 'text');
  }, [executionOutput, isOwner]);

  return { lines, textLines, isOwner, isRunning: isExecuting && isOwner };
}
