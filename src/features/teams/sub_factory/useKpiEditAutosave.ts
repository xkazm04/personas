// Persists the open KPI console's calibration + assessment edits to dev_kpis,
// debounced, and FLUSHES a pending save when the console closes or the Factory
// unmounts. Extracted from FactoryShell, whose inline debounce only cleared its
// timer on cleanup: an edit made in the last window before Back, a crumb, a
// project switch or leaving the page stayed on screen and never reached the DB.
import { useCallback, useEffect, useRef } from 'react';

import { saveKpiAssessment } from '@/api/devTools/kpis';
import { silentCatch } from '@/lib/silentCatch';

import type { KpiEdit } from './factoryModel';

export function useKpiEditAutosave(kpiId: string | null, edits: Record<string, KpiEdit>, delayMs = 600): void {
  const pending = useRef<{ id: string; edit: KpiEdit } | null>(null);

  const flush = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    void saveKpiAssessment(p.id, {
      warnAt: p.edit.warnAt,
      critAt: p.edit.critAt,
      manualRating: p.edit.rating,
      pros: p.edit.pros,
      cons: p.edit.cons,
    }).catch(silentCatch('FactoryShell:saveKpiAssessment'));
  }, []);

  // Declared FIRST on purpose: React runs cleanups in declaration order, and
  // this one must still see the pending edit when the console closes
  // (kpiId changes) or the shell unmounts. It does not re-run on an edit.
  useEffect(() => () => flush(), [kpiId, flush]);

  useEffect(() => {
    if (!kpiId) return;
    const edit = edits[kpiId];
    if (!edit) return;
    pending.current = { id: kpiId, edit };
    const t = setTimeout(flush, delayMs);
    return () => clearTimeout(t);
  }, [kpiId, edits, delayMs, flush]);
}
