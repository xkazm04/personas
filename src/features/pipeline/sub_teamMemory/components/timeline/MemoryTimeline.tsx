import { useMemo, useState } from 'react';
import { GitCommitVertical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import { RunMarker, type RunGroup } from './TimelineControls';
import { ManualGroup } from './TimelineItem';

interface TimelineEntry {
  type: 'run' | 'manual';
  runGroup?: RunGroup;
  manualGroup?: { memories: TeamMemory[]; afterRunId: string | null };
}

function buildTimeline(memories: TeamMemory[]): TimelineEntry[] {
  const sorted = [...memories].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const runMap = new Map<string, TeamMemory[]>();
  const manualMemories: TeamMemory[] = [];

  for (const m of sorted) {
    if (m.run_id) {
      const list = runMap.get(m.run_id);
      if (list) list.push(m); else runMap.set(m.run_id, [m]);
    } else {
      manualMemories.push(m);
    }
  }

  const runGroups: RunGroup[] = Array.from(runMap.entries())
    .map(([runId, mems]) => ({ runId, memories: mems, firstCreatedAt: mems[0]!.created_at }))
    .sort((a, b) => new Date(a.firstCreatedAt).getTime() - new Date(b.firstCreatedAt).getTime());

  const entries: TimelineEntry[] = [];
  let manualIdx = 0;

  for (const rg of runGroups) {
    const rgTime = new Date(rg.firstCreatedAt).getTime();
    const beforeManual: TeamMemory[] = [];
    while (manualIdx < manualMemories.length) {
      if (new Date(manualMemories[manualIdx]!.created_at).getTime() < rgTime) {
        beforeManual.push(manualMemories[manualIdx]!);
        manualIdx++;
      } else break;
    }
    if (beforeManual.length > 0) {
      entries.push({ type: 'manual', manualGroup: { memories: beforeManual, afterRunId: null } });
    }
    entries.push({ type: 'run', runGroup: rg });
  }

  if (manualIdx < manualMemories.length) {
    entries.push({
      type: 'manual',
      manualGroup: {
        memories: manualMemories.slice(manualIdx),
        afterRunId: runGroups.length > 0 ? runGroups[runGroups.length - 1]!.runId : null,
      },
    });
  }

  return entries.reverse();
}

interface MemoryTimelineProps {
  memories: TeamMemory[];
  stats: TeamMemoryStats | null;
  onFilterRun: (runId: string | null) => void;
  activeRunFilter: string | null;
}

export default function MemoryTimeline({ memories, stats, onFilterRun, activeRunFilter }: MemoryTimelineProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const timeline = useMemo(() => buildTimeline(memories), [memories]);
  const runCounts = useMemo(() => {
    if (!stats?.run_counts) return new Map<string, number>();
    return new Map(stats.run_counts);
  }, [stats]);

  const toggleRun = (runId: string) => {
    setExpandedRuns((prev) => { const next = new Set(prev); if (next.has(runId)) next.delete(runId); else next.add(runId); return next; });
  };

  if (timeline.length === 0) {
    return (
      <div className="text-center py-4">
        <GitCommitVertical className="w-6 h-6 mx-auto mb-1.5 text-foreground" />
        <p className="typo-body text-foreground">{pt.no_timeline_data}</p>
      </div>
    );
  }

  const totalRuns = runCounts.size;

  return (
    <div className="space-y-1">
      {totalRuns > 0 && (
        <div className="flex items-center gap-2 px-2 py-1">
          <GitCommitVertical className="w-3 h-3 text-violet-400/60" />
          <span className="typo-body text-foreground">
            {totalRuns} run{totalRuns !== 1 ? 's' : ''}
          </span>
          {activeRunFilter && (
            <button onClick={() => onFilterRun(null)} className="typo-body text-violet-400 hover:text-violet-300 transition-colors ml-auto">
              {pt.clear_filter}
            </button>
          )}
        </div>
      )}

      <div className="space-y-1 relative">
        <div className="absolute left-[19px] top-2 bottom-2 w-px bg-primary/8" />
        {timeline.map((entry, i) => {
          if (entry.type === 'run' && entry.runGroup) {
            const rg = entry.runGroup;
            return (
              <RunMarker key={rg.runId} group={rg} isExpanded={expandedRuns.has(rg.runId)} onToggle={() => toggleRun(rg.runId)} onFilterRun={onFilterRun} isFiltered={activeRunFilter === rg.runId} />
            );
          }
          if (entry.type === 'manual' && entry.manualGroup) {
            return <ManualGroup key={`manual-${i}`} memories={entry.manualGroup.memories} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}
