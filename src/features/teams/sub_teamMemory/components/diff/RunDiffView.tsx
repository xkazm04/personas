import { useTranslation } from '@/i18n/useTranslation';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { GitCompareArrows } from 'lucide-react';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import { listTeamMemoriesByRun } from '@/api/pipeline/teamMemories';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { createLatestWins } from '@/stores/util/latestWins';
import { computeMemoryDiff, type MemoryRunDiff } from '../../libs/memoryDiff';
import DiffHeader from './DiffHeader';
import DiffContent from './DiffContent';

interface RunDiffViewProps {
  stats: TeamMemoryStats | null;
  onClose: () => void;
}

export default function RunDiffView({ stats, onClose }: RunDiffViewProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  const runs = useMemo<[string, number][]>(
    () => (stats?.run_counts ?? []).map(([id, c]) => [id, Number(c)]),
    [stats],
  );
  const [runA, setRunA] = useState<string>('');
  const [runB, setRunB] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<MemoryRunDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seed the pair ONCE. `runs` is derived from `stats`, which the panel refetches
  // after every create/edit/delete and every filter change -- so this effect used
  // to re-run with a fresh array identity and snap the reader's chosen pair back
  // to "the last two runs" underneath them. The baseline is the reader's choice
  // the moment they make one.
  const pairSeededRef = useRef(false);
  useEffect(() => {
    if (pairSeededRef.current || runs.length === 0) return;
    if (runs.length >= 2) {
      setRunA(runs[runs.length - 2]![0]);
      setRunB(runs[runs.length - 1]![0]);
    } else {
      setRunB(runs[0]![0]);
    }
    pairSeededRef.current = true;
  }, [runs]);

  const canCompare = runA && runB && runA !== runB;

  // A comparison request carries an identity minted at issue time; a response
  // is applied only if it still answers the CURRENT pair. Without it the reader
  // switches to pair B, run A's slower answer lands second, and a correctly
  // computed diff is painted under the wrong header — unnoticeable by
  // construction. `createLatestWins` is the repo's one implementation of this.
  const latestWinsRef = useRef(createLatestWins());

  const handleCompare = useCallback(async () => {
    if (!canCompare) return;
    const token = latestWinsRef.current.next();
    setLoading(true);
    setError(null);
    setDiff(null);
    try {
      const [memoriesA, memoriesB] = await Promise.all([
        listTeamMemoriesByRun(runA),
        listTeamMemoriesByRun(runB),
      ]);
      if (!latestWinsRef.current.isCurrent(token)) return;
      setDiff(computeMemoryDiff(memoriesA, memoriesB));
    } catch (err) {
      if (!latestWinsRef.current.isCurrent(token)) return;
      // The RAW message is stored and translated at render time: pulling `t`
      // into this callback's deps would put a value that changes on every
      // language load into the auto-compare effect below, which fires on
      // `handleCompare` identity.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (latestWinsRef.current.isCurrent(token)) setLoading(false);
    }
  }, [runA, runB, canCompare]);

  useEffect(() => {
    if (canCompare) handleCompare();
  }, [canCompare, handleCompare, runA, runB]);

  if (runs.length < 2) {
    return (
      <div className="text-center py-6 px-3">
        <GitCompareArrows className="w-8 h-8 mx-auto mb-2 text-foreground" />
        <p className="typo-caption text-foreground">{pt.need_two_runs}</p>
        <button type="button" onClick={onClose} className="mt-2 typo-caption text-violet-400 hover:text-violet-300">{t.common.back}</button>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1 py-1">
      <DiffHeader runs={runs} runA={runA} runB={runB} onRunAChange={setRunA} onRunBChange={setRunB} />

      {/* A surface fetching its data gets a calm geometry-matched ghost, never a
          spinner. `LoadingSpinner` stood here and renders null, so the only
          in-flight signal was the label beside it. */}
      {loading && (
        <div aria-busy="true" className="space-y-2 px-1 py-1">
          <span className="typo-caption text-foreground">{pt.comparing_runs}</span>
          <div className="h-7 rounded-card bg-primary/5" />
          <div className="h-16 rounded-card bg-primary/5" />
        </div>
      )}

      {/* A failed comparison renders as a failure with a retry — never as an
          empty diff, which reads as "nothing changed" and gets acted on. */}
      {error && !loading && (
        <div className="typo-caption text-red-400/80 px-2 py-1.5 rounded-card bg-red-500/10 flex items-center justify-between gap-2">
          <span>{resolveErrorTranslated(t, error).message}</span>
          <button
            type="button"
            onClick={() => { void handleCompare(); }}
            className="typo-caption text-violet-400 hover:text-violet-300 flex-shrink-0"
          >
            {t.common.retry}
          </button>
        </div>
      )}

      {diff && !loading && <DiffContent diff={diff} />}
    </div>
  );
}
