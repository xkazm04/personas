// Cancel the running Measure, at most once: a second press while the first is
// on its way, or while the snapshot already says `cancelling`, does nothing.
// The session hears the ask at once (the control turns to "Cancelling" before
// the API answers); a failed ask is taken back and said inline by the caller.
import { useCallback, useEffect, useRef, useState } from 'react';

import { cancelLifecycleMeasure } from '@/api/devTools/lifecycle';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { isTauriError } from '@/lib/types/tauriError';

import { useLifecycleViewModel } from '../context';
import { isMeasuring, useMeasureSession } from './measureSession';

export interface CancelMeasure {
  cancel: () => Promise<void>;
  /** Why the last ask failed, in the product's words; null otherwise. */
  failure: string | null;
}

export function useCancelMeasure(): CancelMeasure {
  const { projectId } = useLifecycleViewModel();
  const { phase, markCancelAsked } = useMeasureSession();
  const asked = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);

  // A new Measure (or none) can be cancelled again.
  const under = isMeasuring(phase);
  useEffect(() => {
    if (!under) asked.current = false;
  }, [under]);

  const cancel = useCallback(async () => {
    if (!projectId || asked.current || phase === 'cancelling') return;
    asked.current = true;
    setFailure(null);
    markCancelAsked(true);
    try {
      await cancelLifecycleMeasure(projectId);
    } catch (err) {
      silentCatch('lifecycle:cancelMeasure')(err);
      asked.current = false;
      markCancelAsked(false);
      setFailure(resolveError(isTauriError(err) ? err.error : err instanceof Error ? err.message : String(err)).message);
    }
  }, [projectId, phase, markCancelAsked]);

  return { cancel, failure };
}
