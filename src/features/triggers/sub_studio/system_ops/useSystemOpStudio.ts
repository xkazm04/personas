/**
 * Data layer for the Chain Studio "System events" rail: the catalog of
 * available system operations plus the persisted automations (committed
 * routes), with enable/run/delete actions. Consumed via `useStudioComposer`.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  listSystemOpKinds, listSystemOpAutomations,
  setSystemOpAutomationEnabled, deleteSystemOpAutomation, runSystemOpNow,
  type SystemOpKindMeta, type SystemOpAutomation,
} from '@/api/systemOps';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

export function useSystemOpStudio() {
  const [kinds, setKinds] = useState<SystemOpKindMeta[]>([]);
  const [automations, setAutomations] = useState<SystemOpAutomation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [k, a] = await Promise.all([listSystemOpKinds(), listSystemOpAutomations()]);
      setKinds(k);
      setAutomations(a);
    } catch (err) {
      silentCatch('features/triggers/sub_studio/system_ops/useSystemOpStudio:refresh')(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    try { await setSystemOpAutomationEnabled(id, enabled); await refresh(); }
    catch (err) { toastCatch('SystemOpStudio:toggle')(err); }
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    try { await deleteSystemOpAutomation(id); await refresh(); }
    catch (err) { toastCatch('SystemOpStudio:remove')(err); }
  }, [refresh]);

  // run_now records last_run_at / last_status on the row (mark_run), so the
  // panel re-reads it: without this a clicked "Run now" changed nothing on screen.
  const runNow = useCallback(async (id: string): Promise<boolean> => {
    try { await runSystemOpNow(id); }
    catch (err) { toastCatch('SystemOpStudio:runNow')(err); return false; }
    await refresh();
    return true;
  }, [refresh]);

  return { kinds, automations, loading, refresh, toggle, remove, runNow };
}
