import { useMemo, useState } from 'react';
import { GitCommitVertical, Brain, Zap, ChevronRight } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';

interface RunGroup {
  runId: string;
  memories: TeamMemory[];
  firstCreatedAt: string;
}

interface ManualGroup {
  memories: TeamMemory[];
  afterRunId: string | null;
}

interface TimelineEntry {
  type: 'run' | 'manual';
  runGroup?: RunGroup;
  manualGroup?: ManualGroup;
}

function buildTimeline(memories: TeamMemory[]): TimelineEntry[] {
  // Sort by created_at ascending for chronological ordering
  const sorted = [...memories].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const runMap = new Map<string, TeamMemory[]>();
  const manualMemories: TeamMemory[] = [];

  for (const m of sorted) {
    if (m.run_id) {
      const list = runMap.get(m.run_id);
      if (list) list.push(m);
      else runMap.set(m.run_id, [m]);
    } else {
      manualMemories.push(m);
    }
  }

  // Build ordered run groups by earliest memory timestamp
  const runGroups: RunGroup[] = Array.from(runMap.entries())
    .map(([runId, mems]) => ({
      runId,
      memories: mems,
      firstCreatedAt: mems[0]!.created_at,
    }))
    .sort((a, b) => new Date(a.firstCreatedAt).getTime() - new Date(b.firstCreatedAt).getTime());

  // Interleave manual memories between runs
  const entries: TimelineEntry[] = [];
  let manualIdx = 0;

  for (const rg of runGroups) {
    const rgTime = new Date(rg.firstCreatedAt).getTime();

    // Collect manual memories before this run
    const beforeManual: TeamMemory[] = [];
    while (manualIdx < manualMemories.length) {
      const mt = new Date(manualMemories[manualIdx]!.created_at).getTime();
      if (mt < rgTime) {
        beforeManual.push(manualMemories[manualIdx]!);
        manualIdx++;
      } else break;
    }

    if (beforeManual.length > 0) {
      entries.push({ type: 'manual', manualGroup: { memories: beforeManual, afterRunId: null } });
    }
    entries.push({ type: 'run', runGroup: rg });
  }

  // Remaining manual memories after all runs
  if (manualIdx < manualMemories.length) {
    entries.push({
      type: 'manual',
      manualGroup: {
        memories: manualMemories.slice(manualIdx),
        afterRunId: runGroups.length > 0 ? runGroups[runGroups.length - 1]!.runId : null,
      },
    });
  }

  // Reverse so newest is at the top
  return entries.reverse();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function shortRunId(runId: string): string {
  return runId.length > 8 ? runId.slice(0, 8) : runId;
}

// -- Run Marker ------------------------------------------------------

function RunMarker({
  group,
  isExpanded,
  onToggle,
  onFilterRun,
  isFiltered,
}: {
  group: RunGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onFilterRun: (runId: string) => void;
  isFiltered: boolean;
}) {
  return (
    <div className="relative">
      {/* Run header */}
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl border transition-colors text-left ${
          isFiltered
            ? 'bg-violet-500/15 border-violet-500/25'
            : 'bg-primary/5 border-primary/10 hover:border-primary/20'
        }`}
      >
        <div className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
          <GitCommitVertical className="w-3 h-3 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground/80 font-mono truncate">
              {shortRunId(group.runId)}
            </span>
            <span className="text-sm text-violet-400/80 font-medium">
              {group.memories.length} memor{group.memories.length !== 1 ? 'ies' : 'y'}
            </span>
          </div>
          <span className="text-sm text-muted-foreground/60">{formatTime(group.firstCreatedAt)}</span>
        </div>
        <ChevronRight className={`w-3 h-3 text-muted-foreground/40 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {/* Expanded memories */}
      {isExpanded && (
        <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-violet-500/15 pl-2.5">
          {group.memories.map((m) => (
            <MemoryEntry key={m.id} memory={m} />
          ))}
          {!isFiltered && (
            <button
              onClick={() => onFilterRun(group.runId)}
              className="text-sm text-violet-400/60 hover:text-violet-400 transition-colors pl-1 py-0.5"
            >
              Filter to this run
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// -- Manual Memory Group ---------------------------------------------

function ManualGroup({ memories }: { memories: TeamMemory[] }) {
  return (
    <div className="space-y-0.5">
      {memories.map((m) => (
        <MemoryEntry key={m.id} memory={m} isManual />
      ))}
    </div>
  );
}

// -- Single Memory Entry ---------------------------------------------

const CATEGORY_DOT: Record<string, string> = {
  observation: 'bg-cyan-500',
  decision: 'bg-amber-500',
  context: 'bg-violet-500',
  learning: 'bg-emerald-500',
};

function MemoryEntry({ memory, isManual }: { memory: TeamMemory; isManual?: boolean }) {
  return (
    <div className="flex items-start gap-2 px-2 py-1 rounded-lg hover:bg-primary/5 transition-colors">
      <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${CATEGORY_DOT[memory.category] ?? 'bg-gray-400'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/80 truncate">{memory.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {isManual ? (
            <Brain className="w-2.5 h-2.5 text-muted-foreground/40" />
          ) : (
            <Zap className="w-2.5 h-2.5 text-amber-400/50" />
          )}
          <span className="text-sm text-muted-foreground/60">{formatTime(memory.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

// -- Main Component --------------------------------------------------

interface MemoryTimelineProps {
  memories: TeamMemory[];
  stats: TeamMemoryStats | null;
  onFilterRun: (runId: string | null) => void;
  activeRunFilter: string | null;
}

export default function MemoryTimeline({ memories, stats, onFilterRun, activeRunFilter }: MemoryTimelineProps) {
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());

  const timeline = useMemo(() => buildTimeline(memories), [memories]);

  const runCounts = useMemo(() => {
    if (!stats?.run_counts) return new Map<string, number>();
    return new Map(stats.run_counts);
  }, [stats]);

  const toggleRun = (runId: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  if (timeline.length === 0) {
    return (
      <div className="text-center py-4">
        <GitCommitVertical className="w-6 h-6 mx-auto mb-1.5 text-muted-foreground/20" />
        <p className="text-sm text-muted-foreground/50">No timeline data</p>
      </div>
    );
  }

  // Run summary bar
  const totalRuns = runCounts.size;

  return (
    <div className="space-y-1">
      {/* Run summary strip */}
      {totalRuns > 0 && (
        <div className="flex items-center gap-2 px-2 py-1">
          <GitCommitVertical className="w-3 h-3 text-violet-400/60" />
          <span className="text-sm text-muted-foreground/50">
            {totalRuns} run{totalRuns !== 1 ? 's' : ''}
          </span>
          {activeRunFilter && (
            <button
              onClick={() => onFilterRun(null)}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors ml-auto"
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* Timeline entries */}
      <div className="space-y-1 relative">
        {/* Vertical timeline line */}
        <div className="absolute left-[19px] top-2 bottom-2 w-px bg-primary/8" />

        {timeline.map((entry, i) => {
          if (entry.type === 'run' && entry.runGroup) {
            const rg = entry.runGroup;
            return (
              <RunMarker
                key={rg.runId}
                group={rg}
                isExpanded={expandedRuns.has(rg.runId)}
                onToggle={() => toggleRun(rg.runId)}
                onFilterRun={onFilterRun}
                isFiltered={activeRunFilter === rg.runId}
              />
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
