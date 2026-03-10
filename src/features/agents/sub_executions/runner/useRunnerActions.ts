import { useRef, useEffect, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaExecution } from '@/hooks/execution/usePersonaExecution';
import { formatElapsed } from '@/lib/utils/formatters';
import * as api from '@/api/tauriApi';
import { useToastStore } from '@/stores/toastStore';

interface RunnerActionsArgs {
  personaId: string;
  inputData: string;
  outputLines: string[];
  setOutputLines: React.Dispatch<React.SetStateAction<string[]>>;
  setJsonError: React.Dispatch<React.SetStateAction<string | null>>;
  elapsedMs: number;
  executionSummary: { status: string; duration_ms?: number | null; cost_usd?: number | null; last_tool?: string | null } | null;
  fetchTypicalDuration: (pId: string) => void;
}

/**
 * Encapsulates the execute / stop / resume action handlers and related side-effects
 * (Enter-key shortcut, disconnect-on-unmount, rerun-input pickup).
 */
export function useRunnerActions({
  personaId,
  inputData,
  outputLines,
  setOutputLines,
  setJsonError,
  elapsedMs,
  executionSummary,
  fetchTypicalDuration,
}: RunnerActionsArgs) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const executePersona = usePersonaStore((s) => s.executePersona);
  const cancelExecution = usePersonaStore((s) => s.cancelExecution);
  const isExecuting = usePersonaStore((s) => s.isExecuting);
  const activeExecutionId = usePersonaStore((s) => s.activeExecutionId);
  const cloudConfig = usePersonaStore((s) => s.cloudConfig);
  const cloudExecute = usePersonaStore((s) => s.cloudExecute);

  const { disconnect } = usePersonaExecution();

  // Enter-key shortcut
  const handleExecuteRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || isExecuting) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      handleExecuteRef.current?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExecuting]);

  // Clean up on unmount
  useEffect(() => { return () => { disconnect(); }; }, [disconnect]);

  const handleExecute = useCallback(async () => {
    let parsedInput = {};
    if (inputData.trim()) {
      try { parsedInput = JSON.parse(inputData); }
      catch (e) { setJsonError(e instanceof SyntaxError ? e.message : 'Invalid JSON input'); return; }
    }
    setJsonError(null);
    setOutputLines([]);
    fetchTypicalDuration(personaId);

    if (cloudConfig?.is_connected) {
      try {
        const executionId = await cloudExecute(personaId, JSON.stringify(parsedInput));
        setOutputLines(['Cloud execution started: ' + executionId]);
      } catch {
        setOutputLines(['ERROR: Failed to start cloud execution']);
        useToastStore.getState().addToast('Failed to start cloud execution', 'error');
      }
    } else {
      const executionId = await executePersona(personaId, parsedInput);
      if (executionId) { setOutputLines(['Execution started: ' + executionId]); }
      else { setOutputLines(['ERROR: Failed to start execution']); }
    }
  }, [inputData, personaId, cloudConfig, cloudExecute, executePersona, setJsonError, setOutputLines, fetchTypicalDuration]);

  // Keep ref in sync
  handleExecuteRef.current = handleExecute;

  const handleStop = useCallback(async () => {
    if (activeExecutionId) {
      const lastToolLine = [...outputLines].reverse().find(l => l.startsWith('> Using tool:'));
      const lastTool = lastToolLine?.replace('> Using tool: ', '').trim() || null;
      const cancelSummary = JSON.stringify({ status: 'cancelled', duration_ms: elapsedMs, cost_usd: null, last_tool: lastTool });
      disconnect();
      await cancelExecution(activeExecutionId);
      setOutputLines((prev) => [...prev, '', `[SUMMARY]${cancelSummary}`]);
    }
  }, [activeExecutionId, outputLines, elapsedMs, disconnect, cancelExecution, setOutputLines]);

  const handleResume = useCallback(async () => {
    if (!selectedPersona) return;
    const lastTool = executionSummary?.last_tool;
    const hint = `Previous execution was cancelled${
      executionSummary?.duration_ms ? ` after ${formatElapsed(executionSummary.duration_ms)}` : ''
    }${lastTool ? ` while running tool "${lastTool}"` : ''}. Please continue from where the previous execution left off.`;

    let sessionId: string | null = null;
    if (activeExecutionId) {
      try {
        const exec = await api.getExecution(activeExecutionId, selectedPersona.id);
        sessionId = exec.claude_session_id ?? null;
      } catch { /* intentional */ }
    }

    let parsedInput = {};
    if (inputData.trim()) {
      try { parsedInput = JSON.parse(inputData); } catch { /* intentional */ }
    }
    setOutputLines([]);

    const continuation: import('@/lib/bindings/Continuation').Continuation = sessionId
      ? { type: 'SessionResume', value: sessionId }
      : { type: 'PromptHint', value: hint };

    await executePersona(personaId, parsedInput, undefined, continuation);
  }, [selectedPersona, executionSummary, activeExecutionId, inputData, personaId, executePersona, setOutputLines]);

  return { handleExecute, handleStop, handleResume };
}
