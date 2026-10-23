// Shared plumbing for the Factory's two LLM background tasks: composing a
// codebase measurement for an existing KPI, and proposing a whole KPI from a
// one-line intent. Both follow the same shape — kick off a task, poll its
// status until it settles, surface the streamed log + the final result.
import { useCallback, useEffect, useRef, useState } from 'react';

import { cancelKpiCompose, getKpiComposeStatus, type KpiComposeStatus } from '@/api/devTools/kpis';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';

import type { KpiCategory, MeasureKind } from './factoryModel';

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

/** Drive one compose/propose background task: start it, poll, expose log + result.
 *
 *  Abandoning a RUNNING task (reset, a new run, unmount) cancels it on the
 *  backend. Stopping only the poll left the agent spending on a result nothing
 *  would read: a `kpi_measure` result is applied only by the modal's Apply.
 *  `running` names the task this hook still owns, so a poll that was already
 *  in flight when the task was abandoned lands on nothing. */
export function useComposeTask() {
  const [phase, setPhase] = useState<ComposePhase>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<KpiComposeStatus | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const running = useRef<string | null>(null);
  // Each run and each abandon mints a generation, so a start() that resolves
  // after the task was abandoned (closed while still starting) is cancelled too.
  const generation = useRef(createLatestWins());

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  /** Stop polling and, if a task is still running, cancel it on the backend. */
  const abandon = useCallback(() => {
    stop();
    generation.current.next();
    const id = running.current;
    running.current = null;
    if (id) void cancelKpiCompose(id).catch(silentCatch('useComposeTask:cancelKpiCompose'));
  }, [stop]);

  useEffect(() => abandon, [abandon]);

  const run = useCallback(
    async (start: () => Promise<{ task_id: string }>) => {
      abandon();
      const token = generation.current.next();
      setPhase('running');
      setLines([]);
      setError(null);
      setStatus(null);
      let taskId: string;
      try {
        taskId = (await start()).task_id;
      } catch (e) {
        if (!generation.current.isCurrent(token)) return;
        setError(errMsg(e));
        setPhase('error');
        return;
      }
      if (!generation.current.isCurrent(token)) {
        void cancelKpiCompose(taskId).catch(silentCatch('useComposeTask:cancelKpiCompose'));
        return;
      }
      running.current = taskId;
      timer.current = setInterval(() => {
        void getKpiComposeStatus(taskId)
          .then((s) => {
            if (running.current !== taskId) return; // abandoned while this poll was in flight
            setLines(s.lines ?? []);
            setStatus(s);
            if (s.status === 'completed') {
              running.current = null;
              stop();
              setPhase('done');
            } else if (s.status === 'failed' || s.status === 'cancelled' || s.status === 'not_found') {
              running.current = null;
              stop();
              setError(s.error ?? 'Composition failed.');
              setPhase('error');
            }
          })
          .catch(silentCatch('useComposeTask:getKpiComposeStatus'));
      }, 1500);
    },
    [abandon, stop],
  );

  const reset = useCallback(() => {
    abandon();
    setPhase('idle');
    setLines([]);
    setError(null);
    setStatus(null);
  }, [abandon]);

  return { phase, lines, error, status, run, reset };
}
