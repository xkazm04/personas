import { useCallback, useEffect, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { formatElapsed } from '@/lib/utils/formatters';
import * as api from '@/api/tauriApi';
import { useToastStore } from '@/stores/toastStore';

interface UseRunnerExecutionArgs {
  personaId: string;
  inputData: string;
  setJsonError: (v: string | null) => void;
  setOutputLines: (fn: (prev: string[]) => string[]) => void;
  fetchTypicalDuration: (id: string) => void;
  disconnect: () => void;
  elapsedMs: number;
  executionSummary: { status: string; duration_ms?: number | null; cost_usd?: number | null; last_tool?: string | null } | null;
  outputLines: string[];
  terminalHeight: number;
  setTerminalHeight: (v: number) => void;
  isTerminalFullscreen: boolean;
  setIsTerminalFullscreen: (fn: (prev: boolean) => boolean) => void;
}

export function useRunnerExecution({
  personaId,
  inputData,
  setJsonError,
  setOutputLines,
  fetchTypicalDuration,
  disconnect,
  elapsedMs,
  executionSummary,
  outputLines,
  terminalHeight,
  setTerminalHeight,
  isTerminalFullscreen,
  setIsTerminalFullscreen,
}: UseRunnerExecutionArgs) {
  const executePersona = usePersonaStore((state) => state.executePersona);
  const cancelExecution = usePersonaStore((state) => state.cancelExecution);
  const isExecuting = usePersonaStore((state) => state.isExecuting);
  const activeExecutionId = usePersonaStore((state) => state.activeExecutionId);
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const cloudConfig = usePersonaStore((s) => s.cloudConfig);
  const cloudExecute = usePersonaStore((s) => s.cloudExecute);

  const handleExecute = async () => {
    let parsedInput = {};
    if (inputData.trim()) {
      try { parsedInput = JSON.parse(inputData); }
      catch (e) { setJsonError(e instanceof SyntaxError ? e.message : 'Invalid JSON input'); return; }
    }
    setJsonError(null);
    setOutputLines(() => []);
    fetchTypicalDuration(personaId);

    if (cloudConfig?.is_connected) {
      try {
        const executionId = await cloudExecute(personaId, JSON.stringify(parsedInput));
        setOutputLines(() => ['Cloud execution started: ' + executionId]);
      } catch {
        setOutputLines(() => ['ERROR: Failed to start cloud execution']);
        useToastStore.getState().addToast('Failed to start cloud execution', 'error');
      }
    } else {
      const executionId = await executePersona(personaId, parsedInput);
      if (executionId) {
        setOutputLines(() => ['Execution started: ' + executionId]);
      } else {
        setOutputLines(() => ['ERROR: Failed to start execution']);
      }
    }
  };

  const handleStop = async () => {
    if (activeExecutionId) {
      const lastToolLine = [...outputLines].reverse().find(l => l.startsWith('> Using tool:'));
      const lastTool = lastToolLine?.replace('> Using tool: ', '').trim() || null;
      const cancelSummary = JSON.stringify({ status: 'cancelled', duration_ms: elapsedMs, cost_usd: null, last_tool: lastTool });
      disconnect();
      await cancelExecution(activeExecutionId);
      setOutputLines((prev) => [...prev, '', `[SUMMARY]${cancelSummary}`]);
    }
  };

  const handleResume = async () => {
    if (!selectedPersona) return;
    const lastTool = executionSummary?.last_tool;
    const hint = `Previous execution was cancelled${executionSummary?.duration_ms ? ` after ${formatElapsed(executionSummary.duration_ms)}` : ''}${lastTool ? ` while running tool "${lastTool}"` : ''}. Please continue from where the previous execution left off.`;

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

    setOutputLines(() => []);
    const continuation: import('@/lib/bindings/Continuation').Continuation = sessionId
      ? { type: 'SessionResume', value: sessionId }
      : { type: 'PromptHint', value: hint };
    await executePersona(personaId, parsedInput, undefined, continuation);
  };

  // Enter-key shortcut
  const handleExecuteRef = useRef<(() => void) | null>(null);
  handleExecuteRef.current = handleExecute;

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

  // Drag-to-resize
  const isDraggingTerminal = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const dragListenersRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: () => void } | null>(null);

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingTerminal.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = terminalHeight;
    const onMove = (moveEvent: MouseEvent) => {
      if (!isDraggingTerminal.current) return;
      const delta = moveEvent.clientY - dragStartY.current;
      setTerminalHeight(Math.max(120, Math.min(900, dragStartHeight.current + delta)));
    };
    const onUp = () => {
      isDraggingTerminal.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragListenersRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    dragListenersRef.current = { onMove, onUp };
  }, [terminalHeight]);

  useEffect(() => () => {
    if (dragListenersRef.current) {
      document.removeEventListener('mousemove', dragListenersRef.current.onMove);
      document.removeEventListener('mouseup', dragListenersRef.current.onUp);
    }
  }, []);

  const toggleTerminalFullscreen = useCallback(() => setIsTerminalFullscreen(prev => !prev), []);

  useEffect(() => {
    if (!isTerminalFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsTerminalFullscreen(() => false); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTerminalFullscreen]);

  return {
    handleExecute,
    handleStop,
    handleResume,
    handleTerminalResizeStart,
    toggleTerminalFullscreen,
  };
}
