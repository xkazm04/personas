// Shared plumbing for the Factory's two LLM background tasks: composing a
// codebase measurement for an existing KPI, and proposing a whole KPI from a
// one-line intent. Both follow the same shape — kick off a task, poll its
// status until it settles, surface the streamed log + the final result.
import { useCallback, useEffect, useRef, useState } from 'react';

import { getKpiComposeStatus, type KpiComposeStatus } from '@/api/devTools/kpis';

import type { KpiCategory, MeasureKind } from './factoryMock';

/** Robustly stringify a Tauri/AppError so the UI never shows "[object Object]". */
export function errMsg(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
    if (typeof o.error === 'string') return o.error;
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}

/** Default measurement mechanism per KPI category (the user can switch it). */
export const CATEGORY_DEFAULT_KIND: Record<KpiCategory, MeasureKind> = {
  technical: 'codebase',
  quality: 'connector',
  traffic: 'connector',
  value: 'manual',
};

/** The four orchestrator-DB metrics a "derived" KPI can read (engine/kpi_eval.rs). */
export const DERIVED_METRICS: { id: string; label: string; hint: string }[] = [
  { id: 'qa_bounce_rate', label: 'QA rework rate', hint: 'Bounced ÷ reviewed assignments, last 7 days' },
  { id: 'exec_failure_rate', label: 'Execution failure rate', hint: 'Failed ÷ total persona executions, last 7 days' },
  { id: 'incident_rate', label: 'Open incidents', hint: 'Count of unresolved incidents' },
  { id: 'parked_review_age_days', label: 'Oldest parked review', hint: 'Age in days of the oldest awaiting-review item' },
];

export type ComposePhase = 'idle' | 'running' | 'done' | 'error';

/** Drive one compose/propose background task: start it, poll, expose log + result. */
export function useComposeTask() {
  const [phase, setPhase] = useState<ComposePhase>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<KpiComposeStatus | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const run = useCallback(
    async (start: () => Promise<{ task_id: string }>) => {
      stop();
      setPhase('running');
      setLines([]);
      setError(null);
      setStatus(null);
      let taskId: string;
      try {
        taskId = (await start()).task_id;
      } catch (e) {
        setError(errMsg(e));
        setPhase('error');
        return;
      }
      timer.current = setInterval(() => {
        void getKpiComposeStatus(taskId)
          .then((s) => {
            setLines(s.lines ?? []);
            setStatus(s);
            if (s.status === 'completed') {
              stop();
              setPhase('done');
            } else if (s.status === 'failed' || s.status === 'cancelled' || s.status === 'not_found') {
              stop();
              setError(s.error ?? 'Composition failed.');
              setPhase('error');
            }
          })
          .catch(() => {
            /* transient poll error — keep polling */
          });
      }, 1500);
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    setPhase('idle');
    setLines([]);
    setError(null);
    setStatus(null);
  }, [stop]);

  return { phase, lines, error, status, run, reset };
}
