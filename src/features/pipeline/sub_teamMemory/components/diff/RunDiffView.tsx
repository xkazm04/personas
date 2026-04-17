import { useTranslation } from '@/i18n/useTranslation';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import { listTeamMemoriesByRun } from '@/api/pipeline/teamMemories';
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
  const runs = useMemo(() => stats?.run_counts ?? [], [stats]);
  const [runA, setRunA] = useState<string>('');
  const [runB, setRunB] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<MemoryRunDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (runs.length >= 2) {
      setRunA(runs[runs.length - 2]![0]);
      setRunB(runs[runs.length - 1]![0]);
    } else if (runs.length === 1) {
      setRunB(runs[0]![0]);
    }
  }, [runs]);

  const canCompare = runA && runB && runA !== runB;

  const handleCompare = useCallback(async () => {
    if (!canCompare) return;
    setLoading(true);
    setError(null);
    setDiff(null);
    try {
      const [memoriesA, memoriesB] = await Promise.all([
        listTeamMemoriesByRun(runA),
        listTeamMemoriesByRun(runB),
      ]);
      setDiff(computeMemoryDiff(memoriesA, memoriesB));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run memories');
    } finally {
      setLoading(false);
    }
  }, [runA, runB, canCompare]);

  useEffect(() => {
    if (canCompare) handleCompare();
  }, [runA, runB]);

  if (runs.length < 2) {
    return (
      <div className="text-center py-6 px-3">
        <GitCompareArrows className="w-8 h-8 mx-auto mb-2 text-foreground" />
        <p className="text-xs text-foreground">{pt.need_two_runs}</p>
        <button onClick={onClose} className="mt-2 text-xs text-violet-400 hover:text-violet-300">Back</button>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1 py-1">
      <DiffHeader runs={runs} runA={runA} runB={runB} onRunAChange={setRunA} onRunBChange={setRunB} />

      {loading && (
        <div className="flex items-center justify-center py-4 gap-1.5">
          <LoadingSpinner size="sm" className="text-violet-400" />
          <span className="text-xs text-foreground">{pt.comparing_runs}</span>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400/80 px-2 py-1.5 rounded-card bg-red-500/10">{error}</div>
      )}

      {diff && !loading && <DiffContent diff={diff} />}
    </div>
  );
}
