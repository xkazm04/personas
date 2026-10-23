// The orphanage's read and its three doors (mandate-lanes WP6):
//   draft    (D)  a mandate for the project; when the orphanage found no
//                 steward, the operator picks one first, then D again
//   adopt    (A)  into an existing mandate: pick it, then A again (or Enter)
//   archive  (X)  armed twice: the first press lists what leaves the lane,
//                 the second (X again, or Enter) archives it; Esc disarms
// A refusal the backend states (`validation`) is said in place; anything else
// toasts. Draft and adopt write an act (the act stream re-reads the list);
// archive writes none, so it re-reads itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import { adoptOrphans, archiveOrphans, draftOrphanMandate, listOrphanClusters } from '@/api/mandates';
import { useCharterActRecorded } from '@/features/decision-center/lanes/useLanesSnapshot';
import { refreshLanesSnapshot } from '@/features/decision-center/lanes/lanesSnapshotSource';
import { useTranslation } from '@/i18n/useTranslation';
import type { OrphanClusters } from '@/lib/bindings/OrphanClusters';
import { isTauriError } from '@/lib/types/tauriError';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

export type OrphanMode = 'adopt' | 'draft' | 'archive';

export interface OrphanageState {
  data: OrphanClusters | null;
  failed: boolean;
  /** The door waiting on its second press (adopt and draft: a pick). */
  mode: OrphanMode | null;
  /** The mandate (adopt) or steward (draft) picked. */
  pick: string | null;
  setPick: (id: string | null) => void;
  notice: string | null;
  draft: (project: string, steward: string | null, needsPick: boolean) => Promise<void>;
  adopt: (project: string) => Promise<void>;
  archive: (project: string) => Promise<void>;
  cancel: () => void;
}

export function useOrphanage(): OrphanageState {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const [data, setData] = useState<OrphanClusters | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<OrphanMode | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(() => {
    listOrphanClusters()
      .then((d) => { if (alive.current) { setData(d); setFailed(false); } })
      .catch((err: unknown) => {
        silentCatch('fleet/orphanage:list')(err);
        if (alive.current) setFailed(true);
      });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useCharterActRecorded(refresh);

  const cancel = useCallback(() => { setMode(null); setPick(null); }, []);
  const run = useCallback(async (write: () => Promise<unknown>, done?: (r: unknown) => string | null) => {
    setNotice(null);
    try {
      const r = await write();
      cancel();
      setNotice(done ? done(r) : null);
      refresh();
      void refreshLanesSnapshot();
    } catch (err) {
      if (isTauriError(err) && err.kind === 'validation') { setNotice(err.error); return; }
      toastCatch('fleet/orphanage:write', m.ml_write_failed)(err);
    }
  }, [cancel, refresh, m]);

  const draft = useCallback(async (project: string, steward: string | null, needsPick: boolean) => {
    if (needsPick && mode !== 'draft') { setNotice(null); setMode('draft'); setPick(null); return; }
    if (needsPick && !pick) { setNotice(m.ml_orphans_pick_steward); return; }
    await run(() => draftOrphanMandate(project, needsPick ? pick : steward), () => m.ml_orphans_drafted);
  }, [mode, pick, run, m]);

  const adopt = useCallback(async (project: string) => {
    if (mode !== 'adopt') { setNotice(null); setMode('adopt'); setPick(null); return; }
    if (!pick) { setNotice(m.ml_orphans_pick_mandate); return; }
    const charterId = pick;
    await run(() => adoptOrphans(project, charterId), () => m.ml_orphans_adopted);
  }, [mode, pick, run, m]);

  const archive = useCallback(async (project: string) => {
    if (mode !== 'archive') { setNotice(null); setMode('archive'); setPick(null); return; }
    await run(() => archiveOrphans(project), (n) => tx(m.ml_orphans_archived, { count: typeof n === 'number' ? n : 0 }));
  }, [mode, run, m, tx]);

  return { data, failed, mode, pick, setPick, notice, draft, adopt, archive, cancel };
}
