// Measure, as an action any control can take: the header's Measure button and
// a step screen's "Measure now" start the same Measure the same way, and say a
// refusal the same way. A refusal belongs to the project it was said about.
import { useCallback, useEffect, useState } from 'react';

import { measureLifecycle } from '@/api/devTools/lifecycle';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { isTauriError } from '@/lib/types/tauriError';

import { useLifecycleViewModel } from '../context';
import { isMeasuring, useMeasureSession } from '../measure/measureSession';

/** `nothing`: the plan found no command to run, configured or detected. */
export type MeasureRefusal = { kind: 'nothing' } | { kind: 'other'; text: string };

export interface MeasureNow {
  measure: () => Promise<void>;
  /** A Measure runs for this project (this page's, or one the Overseer started). */
  running: boolean;
  refusal: MeasureRefusal | null;
}

export function useMeasureNow(): MeasureNow {
  const { projectId, snapshot, refetch } = useLifecycleViewModel();
  const { phase } = useMeasureSession();
  const [refusal, setRefusal] = useState<MeasureRefusal | null>(null);
  const running = isMeasuring(phase) || !!snapshot?.measuring;

  useEffect(() => { setRefusal(null); }, [projectId]);

  const measure = useCallback(async () => {
    if (!projectId) return;
    setRefusal(null);
    try {
      await measureLifecycle(projectId);
      refetch();
    } catch (err) {
      silentCatch('lifecycle:measure')(err);
      // `not_found` is the plan finding no command to run, configured or detected.
      if (isTauriError(err) && err.kind === 'not_found') setRefusal({ kind: 'nothing' });
      else setRefusal({ kind: 'other', text: resolveError(isTauriError(err) ? err.error : err instanceof Error ? err.message : String(err)).message });
    }
  }, [projectId, refetch]);

  return { measure, running, refusal };
}
