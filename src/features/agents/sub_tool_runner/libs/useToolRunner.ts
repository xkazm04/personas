import { useState, useCallback, useRef } from 'react';
import { invokeToolDirect, type ToolInvocationResult } from '@/api/agents/tools';

interface ToolRunState {
  isRunning: boolean;
  result: ToolInvocationResult | null;
  error: string | null;
}

interface HistoryEntry {
  result: ToolInvocationResult;
  inputJson: string;
  timestamp: number;
}

const MAX_HISTORY = 10;

export function useToolRunner(personaId: string | undefined) {
  const [states, setStates] = useState<Record<string, ToolRunState>>({});
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({});
  const runningRef = useRef<Set<string>>(new Set());

  const getState = useCallback(
    (toolId: string): ToolRunState =>
      states[toolId] ?? { isRunning: false, result: null, error: null },
    [states],
  );

  const getHistory = useCallback(
    (toolId: string): HistoryEntry[] => history[toolId] ?? [],
    [history],
  );

  const runTool = useCallback(
    async (toolId: string, inputJson: string) => {
      if (!personaId) return;
      if (runningRef.current.has(toolId)) return;

      runningRef.current.add(toolId);
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
        setHistory((prev) => {
          const existing = prev[toolId] ?? [];
          const entry: HistoryEntry = { result, inputJson, timestamp: Date.now() };
          return { ...prev, [toolId]: [entry, ...existing].slice(0, MAX_HISTORY) };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStates((prev) => ({
          ...prev,
          [toolId]: { isRunning: false, result: null, error: msg },
        }));
      } finally {
        runningRef.current.delete(toolId);
      }
    },
    [personaId],
  );

  return { getState, getHistory, runTool };
}
