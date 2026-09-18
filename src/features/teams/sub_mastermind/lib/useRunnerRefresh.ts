import { useCallback, useEffect, useRef } from 'react';

import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import { EventName } from '@/lib/eventRegistry';

import { useSceneStore } from './sceneStore';

/**
 * Keep the canvas's runner lane live.
 *
 * Runners are the third live-process lane beside Fleet sessions and personas,
 * and they were the ONLY one loaded once and never again: `loadRunners` ran in
 * Mastermind's mount batch, so a dev-runner task that started (or finished)
 * after the canvas opened never docked on its island until a remount. Fleet
 * sessions solved the same problem with event subscriptions instead of a poll;
 * this is that, for tasks.
 *
 * Both event names go through `createSingletonListener`, which owns the
 * subscription lifecycle: ONE Tauri listener per event however many surfaces
 * subscribe, teardown when the last one leaves, and an early-arrival buffer so
 * an event landing between mount and the `listen()` promise resolving is
 * delivered rather than dropped.
 */
const onTaskStatus = createSingletonListener<{ job_id: string; status: string; error?: string }>(
  EventName.TASK_EXEC_STATUS,
);
const onTaskComplete = createSingletonListener<{ task_id: string; output_lines: number }>(
  EventName.TASK_EXEC_COMPLETE,
);

/** Trailing window that collapses a burst of task events into ONE runner
 *  refresh. Long enough that a draining queue costs a single list call, short
 *  enough that a started task docks on its island while you watch. */
const COALESCE_MS = 400;

export function useRunnerRefresh(): void {
  const loadRunners = useSceneStore((s) => s.loadRunners);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      // `fresh` REPLACES an in-flight request rather than joining it: the
      // pending one was issued before this event, so its snapshot cannot
      // contain what triggered the reload.
      void loadRunners({ fresh: true });
    }, COALESCE_MS);
  }, [loadRunners]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  onTaskStatus(schedule);
  onTaskComplete(schedule);
}
