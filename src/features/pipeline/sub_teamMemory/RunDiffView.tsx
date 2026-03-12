import { useState, useEffect, useMemo, useCallback } from 'react';
import { GitCompareArrows, Plus, Minus, TrendingUp, TrendingDown, Loader2, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import { listTeamMemoriesByRun } from '@/api/pipeline/teamMemories';
import { computeMemoryDiff, type MemoryRunDiff } from './memoryDiff';

const CATEGORY_COLORS: Record<string, string> = {
  observation: 'text-cyan-400',
  decision: 'text-amber-400',
  context: 'text-violet-400',
  learning: 'text-emerald-400',
};

interface RunDiffViewProps {
  stats: TeamMemoryStats | null;
  onClose: () => void;
}

export default function RunDiffView({ stats, onClose }: RunDiffViewProps) {
  const runs = useMemo(() => stats?.run_counts ?? [], [stats]);
  const [runA, setRunA] = useState<string>('');
  const [runB, setRunB] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<MemoryRunDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<'added' | 'removed' | null>('added');

  // Auto-select the two most recent runs
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

  // Auto-compare when both runs are set
  useEffect(() => {
    if (canCompare) handleCompare();
  }, [runA, runB]);

  const shortId = (id: string) => id.length > 8 ? id.slice(0, 8) : id;

  if (runs.length < 2) {
    return (
      <div className="text-center py-6 px-3">
        <GitCompareArrows className="w-8 h-8 mx-auto mb-2 text-muted-foreground/20" />
        <p className="text-xs text-muted-foreground/50">Need at least 2 runs to compare</p>
        <button onClick={onClose} className="mt-2 text-xs text-violet-400 hover:text-violet-300">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1 py-1">
      {/* Run selectors */}
      <div className="flex items-center gap-1.5 px-1">
        <select
          value={runA}
          onChange={(e) => setRunA(e.target.value)}
          className="flex-1 text-xs bg-primary/5 border border-primary/10 rounded-lg px-1.5 py-1 text-foreground/80 focus:outline-none focus:border-violet-500/30 truncate"
        >
          <option value="" disabled>Base run...</option>
          {runs.map(([id, count]) => (
            <option key={id} value={id} disabled={id === runB}>
              {shortId(id)} ({count})
            </option>
          ))}
        </select>
        <ArrowRight className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
        <select
          value={runB}
          onChange={(e) => setRunB(e.target.value)}
          className="flex-1 text-xs bg-primary/5 border border-primary/10 rounded-lg px-1.5 py-1 text-foreground/80 focus:outline-none focus:border-violet-500/30 truncate"
        >
          <option value="" disabled>Compare run...</option>
          {runs.map(([id, count]) => (
            <option key={id} value={id} disabled={id === runA}>
              {shortId(id)} ({count})
            </option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-4 gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
          <span className="text-xs text-muted-foreground/50">Comparing runs...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400/80 px-2 py-1.5 rounded-lg bg-red-500/10">
          {error}
        </div>
      )}

      {/* Diff results */}
      {diff && !loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2"
        >
          {/* Summary bar */}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-primary/5 border border-primary/10">
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground/50">{diff.totalA}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
              <span className="text-foreground/70 font-medium">{diff.totalB}</span>
            </div>
            <div className="flex-1" />
            {diff.added.length > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-emerald-400">
                <Plus className="w-3 h-3" />{diff.added.length}
              </span>
            )}
            {diff.removed.length > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-red-400">
                <Minus className="w-3 h-3" />{diff.removed.length}
              </span>
            )}
          </div>

          {/* Category diffs */}
          {diff.categoryDiffs.length > 0 && (
            <div className="px-1">
              <p className="text-xs font-medium text-muted-foreground/60 mb-1">Category changes</p>
              <div className="space-y-0.5">
                {diff.categoryDiffs.map((cd) => (
                  <div key={cd.category} className="flex items-center justify-between text-xs px-1.5 py-0.5">
                    <span className={`capitalize ${CATEGORY_COLORS[cd.category] ?? 'text-muted-foreground/60'}`}>
                      {cd.category}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground/60">{cd.countA} {'→'} {cd.countB}</span>
                      {cd.delta !== 0 && (
                        <span className={cd.delta > 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {cd.delta > 0 ? '+' : ''}{cd.delta}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Importance shifts */}
          {diff.importanceShifts.some((s) => Math.abs(s.delta) >= 0.1) && (
            <div className="px-1">
              <p className="text-xs font-medium text-muted-foreground/60 mb-1">Importance shifts</p>
              <div className="space-y-0.5">
                {diff.importanceShifts
                  .filter((s) => Math.abs(s.delta) >= 0.1)
                  .map((s) => (
                    <div key={s.category} className="flex items-center justify-between text-xs px-1.5 py-0.5">
                      <span className={`capitalize ${CATEGORY_COLORS[s.category] ?? 'text-muted-foreground/60'}`}>
                        {s.category}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-muted-foreground/60">
                          {s.avgA.toFixed(1)} {'→'} {s.avgB.toFixed(1)}
                        </span>
                        {s.delta > 0
                          ? <TrendingUp className="w-3 h-3 text-emerald-400" />
                          : <TrendingDown className="w-3 h-3 text-amber-400" />
                        }
                      </span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* Added memories */}
          {diff.added.length > 0 && (
            <div className="px-1">
              <button
                onClick={() => setExpandedSection(expandedSection === 'added' ? null : 'added')}
                className="flex items-center gap-1 text-xs font-medium text-emerald-400 mb-1 hover:text-emerald-300 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {diff.added.length} new memor{diff.added.length === 1 ? 'y' : 'ies'}
              </button>
              {expandedSection === 'added' && (
                <div className="space-y-1 max-h-36 overflow-y-auto scrollbar-thin scrollbar-thumb-primary/10">
                  {diff.added.map((m) => (
                    <DiffMemoryItem key={m.id} memory={m} variant="added" />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Removed memories */}
          {diff.removed.length > 0 && (
            <div className="px-1">
              <button
                onClick={() => setExpandedSection(expandedSection === 'removed' ? null : 'removed')}
                className="flex items-center gap-1 text-xs font-medium text-red-400 mb-1 hover:text-red-300 transition-colors"
              >
                <Minus className="w-3 h-3" />
                {diff.removed.length} removed
              </button>
              {expandedSection === 'removed' && (
                <div className="space-y-1 max-h-36 overflow-y-auto scrollbar-thin scrollbar-thumb-primary/10">
                  {diff.removed.map((m) => (
                    <DiffMemoryItem key={m.id} memory={m} variant="removed" />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* No changes */}
          {diff.added.length === 0 && diff.removed.length === 0 && (
            <div className="text-center py-3">
              <p className="text-xs text-muted-foreground/50">No memory differences between these runs</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function DiffMemoryItem({ memory, variant }: { memory: TeamMemory; variant: 'added' | 'removed' }) {
  const borderColor = variant === 'added' ? 'border-emerald-500/20' : 'border-red-500/20';
  const bgColor = variant === 'added' ? 'bg-emerald-500/5' : 'bg-red-500/5';
  const catColor = CATEGORY_COLORS[memory.category] ?? 'text-muted-foreground/50';

  return (
    <div className={`px-2 py-1.5 rounded-lg border ${borderColor} ${bgColor}`}>
      <p className="text-xs font-medium text-foreground/80 truncate">{memory.title}</p>
      <p className="text-xs text-muted-foreground/60 line-clamp-1 mt-0.5">{memory.content}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className={`text-xs capitalize ${catColor}`}>{memory.category}</span>
        <span className="text-xs text-muted-foreground/60">imp: {memory.importance}</span>
      </div>
    </div>
  );
}
