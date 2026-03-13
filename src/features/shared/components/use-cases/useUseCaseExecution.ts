import { useState, useEffect, useRef, useCallback } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { usePersonaExecution } from '@/hooks/execution/usePersonaExecution';
import { useElapsedTimer } from '@/hooks/utility/timing/useElapsedTimer';
import type { UseCaseItem } from './UseCasesList';

export function useUseCaseExecution(personaId: string, useCase: UseCaseItem, onExecutionFinished?: () => void) {
  const executePersona = useAgentStore((s) => s.executePersona);
  const cancelExecution = useAgentStore((s) => s.cancelExecution);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const activeExecutionId = useAgentStore((s) => s.activeExecutionId);
  const executionOutput = useAgentStore((s) => s.executionOutput);
  const executionPersonaId = useAgentStore((s) => s.executionPersonaId);
  const activeUseCaseId = useAgentStore((s) => s.activeUseCaseId);

  const { disconnect } = usePersonaExecution();

  const mode = useCase.execution_mode ?? 'e2e';
  const hasSchema = (useCase.input_schema?.length ?? 0) > 0;

  const buildFieldValues = useCallback((uc: UseCaseItem): Record<string, unknown> => {
    const vals: Record<string, unknown> = {};
    if (uc.input_schema) {
      for (const field of uc.input_schema) {
        vals[field.key] = uc.sample_input?.[field.key] ?? field.default ?? '';
      }
    }
    return vals;
  }, []);

  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(() => buildFieldValues(useCase));
  const [inputData, setInputData] = useState(() =>
    useCase.sample_input ? JSON.stringify(useCase.sample_input, null, 2) : '{}'
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [terminalHeight, setTerminalHeight] = useState(300);
  const isDraggingTerminal = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const isThisPersonasExecution = executionPersonaId === personaId && personaId !== '';
  const isThisUseCaseExecution = isThisPersonasExecution && activeUseCaseId === useCase.id;
  const elapsedMs = useElapsedTimer(isExecuting && isThisUseCaseExecution, 500);
  const prevIsExecutingRef = useRef(isExecuting);
  const wasOurExecutionRef = useRef(false);

  useEffect(() => {
    setFieldValues(buildFieldValues(useCase));
    setInputData(useCase.sample_input ? JSON.stringify(useCase.sample_input, null, 2) : '{}');
    setJsonError(null);
    setOutputLines([]);
  }, [useCase.id, buildFieldValues]);

  useEffect(() => {
    if (isThisUseCaseExecution && executionOutput.length > 0) {
      setOutputLines(executionOutput);
    } else if (!isThisUseCaseExecution) {
      setOutputLines([]);
    }
  }, [executionOutput, isThisUseCaseExecution]);

  useEffect(() => {
    if (isExecuting && isThisUseCaseExecution) {
      wasOurExecutionRef.current = true;
    }
  }, [isExecuting, isThisUseCaseExecution]);

  useEffect(() => {
    if (prevIsExecutingRef.current && !isExecuting && wasOurExecutionRef.current) {
      wasOurExecutionRef.current = false;
      onExecutionFinished?.();
    }
    prevIsExecutingRef.current = isExecuting;
  }, [isExecuting, onExecutionFinished]);

  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  const handleExecute = async () => {
    if (mode === 'mock') return;

    let parsedInput: Record<string, unknown> = {};
    if (hasSchema) {
      parsedInput = { ...fieldValues };
    } else if (inputData.trim()) {
      try {
        parsedInput = JSON.parse(inputData);
      } catch (e) {
        setJsonError(e instanceof SyntaxError ? e.message : 'Invalid JSON input');
        return;
      }
    }

    if (useCase.time_filter) {
      parsedInput._time_filter = useCase.time_filter;
    }
    parsedInput._use_case = { title: useCase.title, description: useCase.description };

    setJsonError(null);
    setOutputLines([]);
    await executePersona(personaId, parsedInput, useCase.id);
  };

  const handleStop = () => {
    if (activeExecutionId) {
      disconnect();
      cancelExecution(activeExecutionId);
    }
  };

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingTerminal.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = terminalHeight;

    const onMove = (moveEvent: MouseEvent) => {
      if (!isDraggingTerminal.current) return;
      const delta = moveEvent.clientY - dragStartY.current;
      setTerminalHeight(Math.max(120, Math.min(700, dragStartHeight.current + delta)));
    };

    const onUp = () => {
      isDraggingTerminal.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

  return {
    mode, hasSchema,
    fieldValues, setFieldValues,
    inputData, setInputData,
    jsonError, setJsonError,
    outputLines, terminalHeight,
    isExecuting, isThisUseCaseExecution,
    activeExecutionId, elapsedMs,
    handleExecute, handleStop, handleTerminalResizeStart,
  };
}
