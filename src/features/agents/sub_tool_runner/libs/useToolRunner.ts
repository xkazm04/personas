import { useState, useCallback, useEffect, useRef } from 'react';
import { invokeToolDirect, type ToolInvocationResult } from '@/api/agents/tools';
import { extractMessage } from '@/lib/silentCatch';

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

  // Track the latest personaId in a ref so the runTool result-write code can
  // detect a persona switch that happened during the in-flight IPC call.
  // Updated SYNCHRONOUSLY in the render body (not via useEffect) so there is
  // no commit-vs-effect-flush lag — a tool result resolving in the microtask
  // queue between commit and effect-flush would otherwise see a one-render-
  // stale ref and either accept a stale write or drop a valid one.
  const personaIdRef = useRef<string | undefined>(personaId);
  personaIdRef.current = personaId;

  // De-dupe rapid double-clicks on the same toolId for the active persona.
  // Cleared on persona switch by the effect below.
  const runningRef = useRef<Set<string>>(new Set());

  // Reset cached state when the persona changes. Without this, a tool run
  // started under persona A would land in the map keyed only by toolId and
  // be surfaced under persona B (same toolId, different persona) — a
  // cross-persona result bleed.
  useEffect(() => {
    setStates({});
    runningRef.current.clear();
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
            error: 'No active persona. Open a persona before running tools.',
          },
        }));
        return;
      }

      // De-dupe: ignore a second click for the same tool while the first
      // is still in flight. Released in `finally` below.
      if (runningRef.current.has(toolId)) return;

      // Snapshot the persona at call time. The in-flight request belongs to
      // THIS persona; any later persona switch will drop the result below.
      const runPersonaId = personaId;

      runningRef.current.add(toolId);
      setStates((prev) => ({
        ...prev,
        [toolId]: { personaId: runPersonaId, isRunning: true, result: null, error: null },
      }));

      // No local watchdog: the backend bounds the run at 120 s and answers a
      // timeout with a structured, retryable result, and `invokeToolDirect`
      // carries an IPC ceiling above that (TOOL_DIRECT_IPC_TIMEOUT_MS) as the
      // hung-call guard. A 120 s race here fired at the same instant as the
      // backend's own timeout and replaced its typed result with bare text.
      try {
        const result = await invokeToolDirect(toolId, runPersonaId, inputJson);
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
        // Tauri rejects with structured AppError objects, not Error instances —
        // `String(err)` on those renders "[object Object]" (2026-07-16 UAT
        // blocker). extractMessage probes .message/.error/JSON before giving up.
        const msg = extractMessage(err) || 'Tool invocation failed';
        setStates((prev) => {
          if (runPersonaId !== personaIdRef.current) return prev;
          return {
            ...prev,
            [toolId]: { personaId: runPersonaId, isRunning: false, result: null, error: msg },
          };
        });
      } finally {
        // Only release the dedupe slot if we're still on the same persona
        // (otherwise the persona-switch effect already cleared the set).
        if (runPersonaId === personaIdRef.current) {
          runningRef.current.delete(toolId);
        }
      }
    },
    [personaId],
  );

  return { getState, runTool };
}
