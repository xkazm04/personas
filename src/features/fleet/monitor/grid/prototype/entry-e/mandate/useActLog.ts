// The act log's data: one page of `charter_acts` (newest first, up to 500),
// optionally one charter's, re-read on every `charter-act-recorded`. The
// counted filters are counted over that page, the same rows the list shows.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listCharterActs } from '@/api/mandates';
import { useCharterActRecorded } from '@/features/decision-center/lanes/useLanesSnapshot';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import { silentCatch } from '@/lib/silentCatch';

export type ActFilter = 'all' | 'steward' | 'you' | 'revertible' | 'reverted';
export const ACT_FILTERS: readonly ActFilter[] = ['all', 'steward', 'you', 'revertible', 'reverted'];

const PAGE = 500;

/**
 * Which acts a filter keeps. "By steward" is everything the operator did not
 * take (the steward's judgments and the router's filing under its grant);
 * "revertible" is a standing reversible act that is not itself a revert.
 */
export function actMatches(filter: ActFilter, a: CharterAct): boolean {
  switch (filter) {
    case 'all': return true;
    case 'steward': return a.actor !== 'operator';
    case 'you': return a.actor === 'operator';
    case 'revertible': return a.reversible && a.revertedAt === null && a.itemKind !== 'act.revert';
    case 'reverted': return a.revertedAt !== null;
  }
}

export function countFilters(acts: readonly CharterAct[]): Record<ActFilter, number> {
  const out: Record<ActFilter, number> = { all: 0, steward: 0, you: 0, revertible: 0, reverted: 0 };
  for (const a of acts) for (const f of ACT_FILTERS) if (actMatches(f, a)) out[f] += 1;
  return out;
}

export interface ActLogState {
  /** null until the first read lands. */
  acts: CharterAct[] | null;
  failed: boolean;
  counts: Record<ActFilter, number>;
  refresh: () => void;
}

export function useActLog(charterId: string | null): ActLogState {
  const [acts, setActs] = useState<CharterAct[] | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  // StrictMode runs mount, cleanup, mount: the second mount must re-arm it.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(() => {
    listCharterActs({ charterId, actor: null, reversible: null, reverted: null, itemKind: null, itemId: null, limit: PAGE })
      .then((rows) => {
        if (!alive.current) return;
        setActs(rows);
        setFailed(false);
      })
      .catch((err: unknown) => {
        silentCatch('fleet/mandates:acts')(err);
        if (alive.current) setFailed(true);
      });
  }, [charterId]);

  useEffect(() => {
    setActs(null);
    refresh();
  }, [refresh]);
  useCharterActRecorded(refresh);

  const counts = useMemo(() => countFilters(acts ?? []), [acts]);
  return { acts, failed, counts, refresh };
}
