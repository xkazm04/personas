// useQueueActions — the three verbs a board can send to the dispatch queue,
// and the one read that follows each of them.
//
// Every verb awaits the door, then awaits the coalesced snapshot refresh, so
// the promise a control holds (an `AsyncButton`, a `ConfirmDialog`) resolves
// when the board has caught up — not when the request was accepted. A failed
// verb toasts through `toastCatch` and resolves `false`, so a dialog can stay
// open on its own error rather than closing over a queue that did not change
// — and nothing upstream has to catch what was already reported. In
// simulation the door is not there: the verbs are answered locally by the
// caller-supplied `simulate` hooks and never reach IPC.

import { useCallback, useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { fleetQueueCancel, fleetQueueReorder, fleetQueueStartNow } from '@/api/fleet/queue';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

export interface QueueActions {
  /** Resolve `true` when the door accepted the verb and the board caught up. */
  cancel: (sessionId: string) => Promise<boolean>;
  startNow: (sessionId: string) => Promise<boolean>;
  /** The FULL ordered queued-id list, rank 1 first. */
  reorder: (sessionIds: string[]) => Promise<boolean>;
}

/** Local stand-ins for the simulated board — no IPC, no snapshot read. */
export interface SimulatedQueueActions {
  cancel: (sessionId: string) => void;
  startNow: (sessionId: string) => void;
  reorder: (sessionIds: string[]) => void;
}

export function useQueueActions(simulate: SimulatedQueueActions | null): QueueActions {
  const { t } = useTranslation();
  const refresh = useSystemStore((s) => s.fleetQueueRefresh);
  const failed = t.monitor.queue_action_failed;

  const run = useCallback(
    async (site: string, call: () => Promise<unknown>): Promise<boolean> => {
      try {
        await call();
        await refresh();
        return true;
      } catch (err) {
        toastCatch(`fleet/queue:${site}`, failed)(err);
        return false;
      }
    },
    [refresh, failed],
  );

  const cancel = useCallback(
    (id: string) => (simulate ? Promise.resolve(simulate.cancel(id)).then(() => true) : run('cancel', () => fleetQueueCancel(id))),
    [run, simulate],
  );
  const startNow = useCallback(
    (id: string) => (simulate ? Promise.resolve(simulate.startNow(id)).then(() => true) : run('startNow', () => fleetQueueStartNow(id))),
    [run, simulate],
  );
  const reorder = useCallback(
    (ids: string[]) => (simulate ? Promise.resolve(simulate.reorder(ids)).then(() => true) : run('reorder', () => fleetQueueReorder(ids))),
    [run, simulate],
  );

  return useMemo(() => ({ cancel, startNow, reorder }), [cancel, startNow, reorder]);
}
