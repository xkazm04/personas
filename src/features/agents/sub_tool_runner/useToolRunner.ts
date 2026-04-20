import { useState, useCallback, useEffect, useRef } from 'react';
import { invokeToolDirect, type ToolInvocationResult } from '@/api/agents/tools';

interface ToolRunState {
  /** The persona whose tool run produced this entry. Results for any other
   *  persona are treated as stale and never shown. */
  personaId: string;
  isRunning: boolean;
  result: ToolInvocationResult | null;
  error: string | null;
}

const EMPTY_STATE: ToolRunState = {
  personaId: '',
  isRunning: false,
  result: null,
  error: null,
};

export function useToolRunner(personaId: string | undefined) {
  const [states, setStates] = useState<Record<string, ToolRunState>>({});

  // Reset cached state when the persona changes. Without this, a tool run
  // started under persona A would land in the map keyed only by toolId and
  // be surfaced under persona B (same toolId, different persona) — a
  // cross-persona result bleed.
  useEffect(() => {
    setStates({});
  }, [personaId]);

  const getState = useCallback(
    (toolId: string): ToolRunState => {
      const entry = states[toolId];
      if (!entry) return EMPTY_STATE;
      // Defense-in-depth: if the stored persona ever mismatches the current
      // one, hide the entry. The effect above normally zeros the map first.
      if (entry.personaId !== (personaId ?? '')) return EMPTY_STATE;
      return entry;
    },
    [states, personaId],
  );

  const runTool = useCallback(
    async (toolId: string, inputJson: string) => {
      // Surface the missing-persona case instead of silently no-op'ing so
      // users don't stare at an inert Run button.
      if (!personaId) {
        setStates((prev) => ({
          ...prev,
          [toolId]: {
            personaId: '',
            isRunning: false,
            result: null,
            error: 'No active persona — open a persona before running tools.',
          },
        }));
        return;
      }

      // Snapshot the persona at call time. The in-flight request belongs to
      // THIS persona; any later persona switch will drop the result below.
      const runPersonaId = personaId;

      setStates((prev) => ({
        ...prev,
        [toolId]: { personaId: runPersonaId, isRunning: true, result: null, error: null },
      }));

      // Guard against a hung IPC leaving isRunning=true forever.
      const TOOL_RUN_TIMEOUT_MS = 120_000;
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Tool run timed out after ${TOOL_RUN_TIMEOUT_MS / 1000}s`)),
          TOOL_RUN_TIMEOUT_MS,
        );
      });

      try {
        const result = await Promise.race([
          invokeToolDirect(toolId, runPersonaId, inputJson),
          timeout,
        ]);
        setStates((prev) => {
          // Drop the result if the user has since switched personas — this
          // entry no longer belongs to the visible tool runner panel.
          if (runPersonaId !== personaIdRef.current) return prev;
          return {
            ...prev,
            [toolId]: { personaId: runPersonaId, isRunning: false, result, error: null },
          };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStates((prev) => {
          if (runPersonaId !== personaIdRef.current) return prev;
          return {
            ...prev,
            [toolId]: { personaId: runPersonaId, isRunning: false, result: null, error: msg },
          };
        });
      }
    },
    [personaId],
  );

  // Track the latest personaId in a ref so the runTool closures can detect a
  // persona switch at result-write time without being re-created.
  const personaIdRef = useRef<string | undefined>(personaId);
  useEffect(() => {
    personaIdRef.current = personaId;
  }, [personaId]);

  return { getState, runTool };
}
