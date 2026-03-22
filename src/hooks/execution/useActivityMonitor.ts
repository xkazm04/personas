import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

export type StaleLevel = 'active' | 'waiting' | 'stuck';

interface HeartbeatPayload {
  execution_id: string;
  elapsed_ms: number;
  silence_ms: number;
}

/**
 * Tracks execution activity based on heartbeat events emitted by the backend.
 * Returns a stale level: 'active' (<30s silence), 'waiting' (30-120s), 'stuck' (>120s).
 */
export function useActivityMonitor(
  executionId: string | null,
  isRunning: boolean,
): { silenceMs: number; staleLevel: StaleLevel } {
  const [silenceMs, setSilenceMs] = useState(0);
  const lastOutputRef = useRef(Date.now());

  // Reset on new execution or when not running
  useEffect(() => {
    if (!isRunning) {
      setSilenceMs(0);
      lastOutputRef.current = Date.now();
    }
  }, [executionId, isRunning]);

  // Listen for heartbeat events
  useEffect(() => {
    if (!executionId || !isRunning) return;

    let cancelled = false;
    const unlistenPromise = listen<HeartbeatPayload>('execution-heartbeat', (event) => {
      if (cancelled || event.payload.execution_id !== executionId) return;
      setSilenceMs(event.payload.silence_ms);
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [executionId, isRunning]);

  // Also reset silence on output lines (they come more frequently than heartbeats)
  useEffect(() => {
    if (!executionId || !isRunning) return;

    let cancelled = false;
    const unlistenPromise = listen<{ execution_id: string; line: string }>('execution-output', (event) => {
      if (cancelled || event.payload.execution_id !== executionId) return;
      setSilenceMs(0);
      lastOutputRef.current = Date.now();
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [executionId, isRunning]);

  const staleLevel: StaleLevel = silenceMs < 30_000
    ? 'active'
    : silenceMs < 120_000
      ? 'waiting'
      : 'stuck';

  return { silenceMs, staleLevel };
}
