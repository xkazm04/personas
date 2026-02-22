import { useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { usePersonaStore } from '@/stores/personaStore';

interface ExecutionOutputPayload {
  execution_id: string;
  line: string;
}

interface ExecutionStatusPayload {
  execution_id: string;
  status: string;
  error?: string;
  duration_ms?: number;
  cost_usd?: number;
}

export function usePersonaExecution() {
  const appendOutput = usePersonaStore((s) => s.appendExecutionOutput);
  const finishExecution = usePersonaStore((s) => s.finishExecution);
  const clearOutput = usePersonaStore((s) => s.clearExecutionOutput);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    const setupListeners = async () => {
      const unlistenOutput = await listen<ExecutionOutputPayload>(
        'execution-output',
        (event) => {
          const currentExecId = usePersonaStore.getState().activeExecutionId;
          if (event.payload.execution_id === currentExecId) {
            appendOutput(event.payload.line);
          }
        }
      );

      const unlistenStatus = await listen<ExecutionStatusPayload>(
        'execution-status',
        (event) => {
          const currentExecId = usePersonaStore.getState().activeExecutionId;
          if (event.payload.execution_id === currentExecId) {
            if (['completed', 'failed', 'cancelled', 'incomplete'].includes(event.payload.status)) {
              if (event.payload.error) {
                appendOutput(`[ERROR] ${event.payload.error}`);
              }
              const summary = JSON.stringify({
                status: event.payload.status,
                duration_ms: event.payload.duration_ms ?? null,
                cost_usd: event.payload.cost_usd ?? null,
              });
              appendOutput(`[SUMMARY]${summary}`);
              finishExecution(event.payload.status);
            }
          }
        }
      );

      unlistenRef.current = [unlistenOutput, unlistenStatus];
    };

    setupListeners();

    return () => {
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
    };
  }, [appendOutput, finishExecution]);

  const disconnect = useCallback(() => {
    unlistenRef.current.forEach((fn) => fn());
    unlistenRef.current = [];
  }, []);

  return { disconnect, clearOutput };
}
