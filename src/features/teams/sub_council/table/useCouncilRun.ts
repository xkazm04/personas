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

import { useCouncilStore } from '../councilStore';

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

/**
 * One round, from wherever this page's rounds come from.
 *
 * FIXTURE MODE HAS NO BACKEND. `dev_tools_council_get_run` is a Tauri
 * command, so in fixture mode every hop of the walk rejected and the round
 * table opened with five NOT MEASURED members - over a fixture file that
 * carries the whole run. The fixture's rounds are loaded with its galaxy and
 * live in the store; they are read here, by the same walk, so nothing
 * downstream can tell the two sources apart.
 */
async function readRound(runId: string): Promise<CouncilRunDetail> {
  const { fixtureOn, fixtureRuns } = useCouncilStore.getState();
  if (fixtureOn) {
    const detail = fixtureRuns[runId];
    // A fixture run id that resolves to nothing is an ERROR, not an empty
    // table: the round table's failure branch says the read failed, which is
    // the truth, rather than drawing a council that found nothing.
    if (!detail) throw new Error(`reference fixture: no run ${runId}`);
    return detail;
  }
  return getCouncilRun(runId);
}

async function walkChain(latestRunId: string): Promise<CouncilRunDetail[]> {
  const chain: CouncilRunDetail[] = [];
  const seen = new Set<string>();
  let id: string | null = latestRunId;
  while (id && !seen.has(id) && chain.length < MAX_ROUNDS) {
    seen.add(id);
    const detail: CouncilRunDetail = await readRound(id);
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
