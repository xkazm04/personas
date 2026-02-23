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
  const clearOutput = usePersonaStore((s) => s.clearExecutionOutput);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    const setupListeners = async () => {
      let droppedOutputCount = 0;
      let droppedStatusCount = 0;

      const unlistenOutput = await listen<ExecutionOutputPayload>(
        'execution-output',
        (event) => {
          const store = usePersonaStore.getState();
          if (event.payload.execution_id === store.activeExecutionId) {
            store.appendExecutionOutput(event.payload.line);
          } else {
            droppedOutputCount++;
            if (import.meta.env.DEV) {
              console.warn(
                `[usePersonaExecution] Dropped output line (${droppedOutputCount} total): event exec_id=${event.payload.execution_id}, active=${store.activeExecutionId}`
              );
            }
          }
        }
      );

      const unlistenStatus = await listen<ExecutionStatusPayload>(
        'execution-status',
        (event) => {
          const store = usePersonaStore.getState();
          if (event.payload.execution_id === store.activeExecutionId) {
            if (['completed', 'failed', 'cancelled', 'incomplete'].includes(event.payload.status)) {
              if (event.payload.error) {
                store.appendExecutionOutput(`[ERROR] ${event.payload.error}`);
              }
              const summary = JSON.stringify({
                status: event.payload.status,
                duration_ms: event.payload.duration_ms ?? null,
                cost_usd: event.payload.cost_usd ?? null,
              });
              store.appendExecutionOutput(`[SUMMARY]${summary}`);
              store.finishExecution(event.payload.status);
            }
          } else {
            droppedStatusCount++;
            if (import.meta.env.DEV) {
              console.warn(
                `[usePersonaExecution] Dropped status event (${droppedStatusCount} total): event exec_id=${event.payload.execution_id} status=${event.payload.status}, active=${store.activeExecutionId}`
              );
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
  }, []);

  const disconnect = useCallback(() => {
    unlistenRef.current.forEach((fn) => fn());
    unlistenRef.current = [];
  }, []);

  return { disconnect, clearOutput };
}
