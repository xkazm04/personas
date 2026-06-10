import { useEffect, useState } from 'react';
import * as twinApi from '@/api/twin/twin';

/**
 * Training momentum for the active twin: how many quick-interview sessions
 * have been completed (counted by their saved `session_summary` records) and
 * when training last happened. Self-contained fetch over the training-channel
 * communications — re-runs on `refreshToken` change so the header stat stays
 * live as a session completes in the same view.
 */

const MOMENTUM_LIMIT = 100;

export interface TrainingMomentum {
  /** Completed interview sessions within the recent window. */
  sessions: number;
  /** ISO timestamp of the most recent training activity, if any. */
  lastTrainedAt: string | null;
}

export function useTrainingMomentum(twinId: string | null, refreshToken?: unknown): TrainingMomentum {
  const [momentum, setMomentum] = useState<TrainingMomentum>({ sessions: 0, lastTrainedAt: null });

  useEffect(() => {
    if (!twinId) {
      setMomentum({ sessions: 0, lastTrainedAt: null });
      return;
    }
    let cancelled = false;
    twinApi
      .listCommunications(twinId, 'training', MOMENTUM_LIMIT)
      .then((comms) => {
        if (cancelled) return;
        let sessions = 0;
        let last: string | null = null;
        for (const c of comms) {
          if (c.key_facts_json?.includes('session_summary')) sessions += 1;
          if (!last || c.occurred_at > last) last = c.occurred_at;
        }
        setMomentum({ sessions, lastTrainedAt: last });
      })
      .catch(() => {
        if (!cancelled) setMomentum({ sessions: 0, lastTrainedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [twinId, refreshToken]);

  return momentum;
}
