import { useState, useCallback } from 'react';
import { invokeToolDirect, type ToolInvocationResult } from '@/api/agents/tools';

interface ToolRunState {
  isRunning: boolean;
  result: ToolInvocationResult | null;
  error: string | null;
}

export function useToolRunner(personaId: string | undefined) {
  const [states, setStates] = useState<Record<string, ToolRunState>>({});

  const getState = useCallback(
    (toolId: string): ToolRunState =>
      states[toolId] ?? { isRunning: false, result: null, error: null },
    [states],
  );

  const runTool = useCallback(
    async (toolId: string, inputJson: string) => {
      if (!personaId) return;

      setStates((prev) => ({
        ...prev,
        [toolId]: { isRunning: true, result: null, error: null },
      }));

      try {
        const result = await invokeToolDirect(toolId, personaId, inputJson);
        setStates((prev) => ({
          ...prev,
          [toolId]: { isRunning: false, result, error: null },
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStates((prev) => ({
          ...prev,
          [toolId]: { isRunning: false, result: null, error: msg },
        }));
      }
    },
    [personaId],
  );

  return { getState, runTool };
}
