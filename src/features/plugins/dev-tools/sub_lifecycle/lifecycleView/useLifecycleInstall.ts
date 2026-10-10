// "Install into repo", with its result said INLINE beside the action that
// caused it (two-dimensions doctrine: a page reports its own outcome in its
// own geometry; no toasts). The missing bindings read as pending from the
// moment the task is dispatched until the refetched snapshot names that task.
import { useCallback, useEffect, useRef, useState } from 'react';

import { installLifecycle } from '@/api/devTools/lifecycle';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';

import type { LifecycleViewModel } from './useLifecycleView';

export interface InstallNote {
  tone: 'success' | 'warning' | 'error';
  text: string;
  /** The underlying failure, for an error note. */
  cause?: string;
}

export interface LifecycleInstall {
  /** True from dispatch until the refetched snapshot carries the task. */
  forcePending: boolean;
  note: InstallNote | null;
  install: () => Promise<void>;
}

export function useLifecycleInstall(
  dl: LifecycleViewModel['dl'],
  tx: LifecycleViewModel['tx'],
  projectId: string | null,
  snapshot: LifecycleSnapshot | null,
  refetch: () => void,
): LifecycleInstall {
  const [dispatched, setDispatched] = useState<{ projectId: string; taskId: string } | null>(null);
  const [note, setNote] = useState<InstallNote | null>(null);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (dispatched && snapshot?.projectId === dispatched.projectId && snapshot.installTaskId === dispatched.taskId) {
      setDispatched(null);
    }
  }, [dispatched, snapshot]);

  // A note belongs to the project it was said about.
  useEffect(() => { setNote(null); }, [projectId]);

  const install = useCallback(async () => {
    if (!projectId) return;
    try {
      const taskId = await installLifecycle(projectId);
      if (taskId) {
        setDispatched({ projectId, taskId });
        setNote({ tone: 'success', text: tx(dl.lc_install_started, { id: taskId }) });
      } else {
        setNote({ tone: 'warning', text: dl.lc_install_nothing });
      }
      refetchRef.current();
    } catch (err) {
      silentCatch('lifecycle:install')(err);
      const cause = resolveError(err instanceof Error ? err.message : String(err)).message;
      setNote({ tone: 'error', text: dl.lc_install_failed, cause });
    }
  }, [projectId, tx, dl]);

  return { forcePending: !!dispatched && dispatched.projectId === projectId, note, install };
}
