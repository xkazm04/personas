import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type AiHealingPhase =
  | 'idle'
  | 'started'
  | 'diagnosing'
  | 'applying'
  | 'completed'
  | 'failed';

export interface AiHealingState {
  phase: AiHealingPhase;
  lines: string[];
  lastLine: string;
  diagnosis: string | null;
  fixesApplied: string[];
  shouldRetry: boolean;
  executionId: string | null;
}

const MAX_LINES = 500;
const MAX_LINE_LENGTH = 4096;

const INITIAL_STATE: AiHealingState = {
  phase: 'idle',
  lines: [],
  lastLine: '',
  diagnosis: null,
  fixesApplied: [],
  shouldRetry: false,
  executionId: null,
};

/**
 * Listen for AI healing events scoped to a persona.
 *
 * Subscribes to `ai-healing-output` (streamed log lines) and
 * `ai-healing-status` (phase changes) events filtered by `personaId`.
 */
export function useAiHealingStream(personaId: string): AiHealingState {
  const [state, setState] = useState<AiHealingState>(INITIAL_STATE);
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  const personaIdRef = useRef(personaId);
  personaIdRef.current = personaId;

  const cleanup = useCallback(() => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  useEffect(() => {
    // Reset when persona changes
    setState(INITIAL_STATE);
    cleanup();

    let mounted = true;

    const setup = async () => {
      const unlistenOutput = await listen<Record<string, unknown>>(
        'ai-healing-output',
        (event) => {
          if (!mounted) return;
          const payload = event.payload ?? {};
          if (String(payload['persona_id'] ?? '') !== personaIdRef.current) return;

          const rawLine = payload['line'];
          if (typeof rawLine !== 'string' || rawLine.trim().length === 0) return;

          const line =
            rawLine.length > MAX_LINE_LENGTH
              ? rawLine.slice(0, MAX_LINE_LENGTH) + '...[truncated]'
              : rawLine;

          setState((prev) => {
            const lines =
              prev.lines.length >= MAX_LINES
                ? [...prev.lines.slice(prev.lines.length - MAX_LINES + 1), line]
                : [...prev.lines, line];
            return { ...prev, lines, lastLine: line };
          });
        },
      );

      const unlistenStatus = await listen<Record<string, unknown>>(
        'ai-healing-status',
        (event) => {
          if (!mounted) return;
          const payload = event.payload ?? {};
          if (String(payload['persona_id'] ?? '') !== personaIdRef.current) return;

          const phase = payload['phase'] as AiHealingPhase | undefined;
          if (!phase) return;

          setState((prev) => ({
            ...prev,
            phase,
            executionId:
              typeof payload['execution_id'] === 'string'
                ? payload['execution_id']
                : prev.executionId,
            diagnosis:
              typeof payload['diagnosis'] === 'string'
                ? payload['diagnosis']
                : prev.diagnosis,
            fixesApplied: Array.isArray(payload['fixes_applied'])
              ? (payload['fixes_applied'] as string[])
              : prev.fixesApplied,
            shouldRetry:
              typeof payload['should_retry'] === 'boolean'
                ? payload['should_retry']
                : prev.shouldRetry,
          }));
        },
      );

      unlistenersRef.current = [unlistenOutput, unlistenStatus];
    };

    setup();

    return () => {
      mounted = false;
      cleanup();
    };
  }, [personaId, cleanup]);

  return state;
}
