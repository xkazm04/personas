// The browser-UAT gate's own state and acts.
//
// Split out of `GoalDetailDrawer` 2026-10-05, which held 14 state slots and 20
// handlers in one 774-line component. Four of those handlers and four of the
// state slots belong to one feature - the verification gate - so they travel
// together.
import { useCallback, useEffect, useRef, useState } from 'react';

import * as devApi from '@/api/devTools/devTools';
import { toastCatch } from '@/lib/silentCatch';

export interface GoalUat {
  scenario: string;
  setScenario: (v: string) => void;
  url: string;
  setUrl: (v: string) => void;
  running: boolean;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  save: () => Promise<void>;
  clear: () => Promise<void>;
  run: () => Promise<void>;
  markPassed: () => Promise<void>;
}

export function useGoalUat({ goalId, isOpen, refresh, confirmMarkPassed }: {
  goalId: string | null;
  isOpen: boolean;
  refresh: () => Promise<void>;
  /** The translated confirm copy for the override path. */
  confirmMarkPassed: string;
}): GoalUat {
  const [scenario, setScenario] = useState('');
  const [url, setUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Handle for the one-shot "refresh shortly after starting UAT" timer, so it
  // can be cancelled if the drawer closes / the goal switches before it fires.
  const timer = useRef<number | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => clearTimer, [clearTimer]);
  useEffect(() => { clearTimer(); }, [goalId, isOpen, clearTimer]);

  const save = useCallback(async () => {
    if (!goalId || !scenario.trim()) return;
    try {
      await devApi.setGoalVerification(goalId, scenario.trim(), url.trim() || undefined);
      setShowForm(false);
      setScenario('');
      setUrl('');
      await refresh();
    } catch (err) {
      toastCatch('Failed to add UAT gate')(err);
    }
  }, [goalId, scenario, url, refresh]);

  const clear = useCallback(async () => {
    if (!goalId) return;
    try {
      await devApi.clearGoalVerification(goalId);
      await refresh();
    } catch (err) {
      toastCatch('Failed to remove UAT gate')(err);
    }
  }, [goalId, refresh]);

  const run = useCallback(async () => {
    if (!goalId) return;
    setRunning(true);
    try {
      // Spawns the browser-test turn (panel-side); the report card closes the
      // gate on a clean pass. Refresh shortly after so the "verifying" state
      // and any same-turn completion reflect.
      await devApi.runGoalUat(goalId);
      clearTimer();
      // Cancelled by the effect above if the drawer closes or the goal changes
      // before this fires.
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void refresh();
      }, 4000);
    } catch (err) {
      toastCatch('Failed to start UAT')(err);
    } finally {
      setRunning(false);
    }
  }, [goalId, refresh, clearTimer]);

  const markPassed = useCallback(async () => {
    if (!goalId) return;
    if (!window.confirm(confirmMarkPassed)) return;
    try {
      // Override path: closes the gate without a test run - for when UAT was
      // verified out-of-band, or the report omitted goal_id so auto-close did
      // not fire. The gate re-opens if new work is added later.
      await devApi.completeGoalUat(goalId);
      await refresh();
    } catch (err) {
      toastCatch('Failed to mark UAT passed')(err);
    }
  }, [goalId, refresh, confirmMarkPassed]);

  return { scenario, setScenario, url, setUrl, running, showForm, setShowForm, save, clear, run, markPassed };
}
