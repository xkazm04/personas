/**
 * useClaimAudit — one mandate's act log, for the Accept card's audit sample.
 *
 * Reads `charter_acts_list` for the charter only while one is given (a claim
 * on a project no mandate holds has nothing to audit and reads nothing), and
 * re-reads on every `charter-act-recorded`, so a revert taken from the sample
 * shows as reverted at once. Loading pattern v2: `acts` is null until the
 * first read lands; a failed read is `failed` and keeps what was there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { listCharterActs } from '@/api/mandates';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import { silentCatch } from '@/lib/silentCatch';

import { useCharterActRecorded } from '../lanes/useLanesSnapshot';

/** Enough acts that a random sample is a fair spot check; the backend caps at 500. */
const AUDIT_PAGE = 200;

export interface ClaimAudit {
  acts: CharterAct[] | null;
  failed: boolean;
  refresh: () => void;
}

export function useClaimAudit(charterId: string | null): ClaimAudit {
  const [acts, setActs] = useState<CharterAct[] | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (!charterId) return;
    listCharterActs({ charterId, actor: null, reversible: null, reverted: null, itemKind: null, itemId: null, limit: AUDIT_PAGE })
      .then((rows) => {
        if (!alive.current) return;
        setActs(rows);
        setFailed(false);
      })
      .catch((err: unknown) => {
        silentCatch('decisionCenter.claimAudit')(err);
        if (alive.current) setFailed(true);
      });
  }, [charterId]);

  useEffect(() => {
    setActs(null);
    setFailed(false);
    refresh();
  }, [refresh]);
  useCharterActRecorded(refresh);

  return { acts, failed, refresh };
}
