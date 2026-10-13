// useScheduledTasks — the schedule plate's one read, rolled every 30 s (the useAutopilotStatus idiom:
// mount + 30 s + visibility, a single-slot module cache so a remount paints warm). The toggle
// applies the list the command returns, so the plate never shows a state it did not just read.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fleetScheduledTasks, setFleetScheduledTaskEnabled } from '@/api/fleet/schedules';
import { silentCatch } from '@/lib/silentCatch';
import type { ScheduledTaskView } from '@/lib/bindings/ScheduledTaskView';

const POLL_MS = 30_000;

let warm: ScheduledTaskView[] | null = null;

export interface ScheduledTasksState {
  /** `null` until the first read lands; `[]` when nothing is scheduled (or off Windows). */
  tasks: ScheduledTaskView[] | null;
  /** The task name being switched right now, if any. */
  saving: string | null;
  setEnabled: (name: string, enabled: boolean) => Promise<void>;
}

export function useScheduledTasks(): ScheduledTasksState {
  const [tasks, setTasks] = useState<ScheduledTaskView[] | null>(warm);
  const [saving, setSaving] = useState<string | null>(null);
  const fetching = useRef(false);
  const cancelled = useRef(false);

  const refresh = useCallback(() => {
    if (fetching.current) return;
    fetching.current = true;
    fleetScheduledTasks()
      .then((list) => {
        warm = list;
        if (!cancelled.current) setTasks(list);
      })
      .catch(silentCatch('fleet/SchedulePlate'))
      .finally(() => {
        fetching.current = false;
      });
  }, []);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const tick = () => {
      if (!document.hidden) refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const setEnabled = useCallback(async (name: string, enabled: boolean) => {
    setSaving(name);
    try {
      const list = await setFleetScheduledTaskEnabled(name, enabled);
      warm = list;
      if (!cancelled.current) setTasks(list);
    } finally {
      if (!cancelled.current) setSaving(null);
    }
  }, []);

  return { tasks, saving, setEnabled };
}
