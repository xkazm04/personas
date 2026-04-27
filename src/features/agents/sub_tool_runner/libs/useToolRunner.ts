import { useState, useCallback, useRef, useEffect } from 'react';
import { invokeToolDirect, type ToolInvocationResult } from '@/api/agents/tools';

interface ToolRunState {
  isRunning: boolean;
  result: ToolInvocationResult | null;
  error: string | null;
}

export function useToolRunner(personaId: string | undefined) {
  const [states, setStates] = useState<Record<string, ToolRunState>>({});
  const runningRef = useRef<Set<string>>(new Set());

  // Always-current personaId for post-await staleness checks. The state map is
  // keyed only by toolId, so a persona switch mid-invoke would otherwise let
  // persona A's tool result land in persona B's panel (real cost, real cross-
  // persona data leak in the displayed result).
  const currentPersonaIdRef = useRef(personaId);
  useEffect(() => {
    currentPersonaIdRef.current = personaId;
    // Drop any per-toolId run state on persona switch so the new persona starts
    // with a clean slate; in-flight invokes for the old persona will short-
    // circuit their setStates via the staleness guard below.
    setStates({});
    runningRef.current.clear();
  }, [personaId]);

  const getState = useCallback(
    (toolId: string): ToolRunState =>
      states[toolId] ?? { isRunning: false, result: null, error: null },
    [states],
  );

  const runTool = useCallback(
    async (toolId: string, inputJson: string) => {
      if (!personaId) return;
      if (runningRef.current.has(toolId)) return;

      const runPersonaId = personaId;
      runningRef.current.add(toolId);
      setStates((prev) => ({
        ...prev,
        [toolId]: { isRunning: true, result: null, error: null },
      }));

      try {
        const result = await invokeToolDirect(toolId, runPersonaId, inputJson);
        if (currentPersonaIdRef.current !== runPersonaId) return;
        setStates((prev) => ({
          ...prev,
          [toolId]: { isRunning: false, result, error: null },
        }));
      } catch (err) {
        if (currentPersonaIdRef.current !== runPersonaId) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStates((prev) => ({
          ...prev,
          [toolId]: { isRunning: false, result: null, error: msg },
        }));
      } finally {
        if (currentPersonaIdRef.current === runPersonaId) {
          runningRef.current.delete(toolId);
        }
      }
    },
    [personaId],
  );

  return { getState, runTool };
}
