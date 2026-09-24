// Reading one council's rounds.
//
// `dev_tools_council_get_run` returns ONE run. The round history needs the
// whole chain, and the only link the wire carries is `supersedesRunId`, so
// the chain is walked backwards from the latest run, one hop at a time, and
// the walk is bounded: a chain that loops or that is longer than the council
// can produce stops rather than fetching forever.
import { useCallback, useEffect, useState } from 'react';

import { getCouncilRun } from '@/api/devTools/council';
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import { silentCatch } from '@/lib/silentCatch';

/** Round 4 is refused by the skill, so a chain is at most a handful long. */
const MAX_ROUNDS = 8;

export interface CouncilRunView {
  status: 'idle' | 'loading' | 'loaded' | 'failed';
  /** The round on screen. */
  detail: CouncilRunDetail | null;
  /** Every round of this subject, oldest first. */
  chain: CouncilRunDetail[];
  error: unknown;
  /** Move to another round by its run id, without refetching the chain. */
  showRound: (runId: string) => void;
  reload: () => void;
}

async function walkChain(latestRunId: string): Promise<CouncilRunDetail[]> {
  const chain: CouncilRunDetail[] = [];
  const seen = new Set<string>();
  let id: string | null = latestRunId;
  while (id && !seen.has(id) && chain.length < MAX_ROUNDS) {
    seen.add(id);
    const detail: CouncilRunDetail = await getCouncilRun(id);
    chain.push(detail);
    id = detail.run.supersedesRunId;
  }
  return chain.reverse();
}

export function useCouncilRun(latestRunId: string | null): CouncilRunView {
  const [status, setStatus] = useState<CouncilRunView['status']>('idle');
  const [chain, setChain] = useState<CouncilRunDetail[]>([]);
  const [shownId, setShownId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!latestRunId) {
      setStatus('idle');
      setChain([]);
      setShownId(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);
    walkChain(latestRunId)
      .then((rounds) => {
        if (cancelled) return;
        setChain(rounds);
        setShownId(latestRunId);
        setStatus('loaded');
      })
      .catch((err) => {
        silentCatch('council:run')(err);
        if (cancelled) return;
        // A read failure is an inline error with a retry, never an empty
        // round table that reads as "this council found nothing".
        setError(err);
        setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [latestRunId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const showRound = useCallback((runId: string) => setShownId(runId), []);
  const detail = chain.find((d) => d.run.id === shownId) ?? chain[chain.length - 1] ?? null;

  return { status, detail, chain, error, showRound, reload };
}
