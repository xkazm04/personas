import { useMemo } from 'react';
import { FlaskConical, Trophy } from 'lucide-react';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ArenaResultsView } from './ArenaResultsView';
import type { LabArenaRun } from '@/lib/bindings/LabArenaRun';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';

interface ArenaHistoryProps {
  runs: LabArenaRun[];
  resultsMap: Record<string, LabArenaResult[]>;
  expandedRunId: string | null;
  onToggleExpand: (runId: string | null) => void;
  onDelete: (runId: string) => void;
}

function parseSummary(run: LabArenaRun) {
  if (!run.summary) return null;
  try {
    return JSON.parse(run.summary) as { best_quality_model?: string };
  } catch { return null; }
}

function parseModels(run: LabArenaRun): string[] {
  try { return JSON.parse(run.modelsTested); } catch { return []; }
}

const COLUMNS: LabHistoryColumn<LabArenaRun>[] = [
  {
    key: 'models',
    label: 'Models',
    render: (run) => (
      <span className="text-sm text-foreground/80 font-medium">{parseModels(run).join(', ') || '--'}</span>
    ),
  },
  {
    key: 'scenarios',
    label: 'Scenarios',
    className: 'w-[90px]',
    render: (run) => <span className="text-sm text-muted-foreground/80">{run.scenariosCount || '--'}</span>,
  },
  {
    key: 'best',
    label: 'Best',
    className: 'w-[120px]',
    render: (run) => {
      const s = parseSummary(run);
      return s?.best_quality_model
        ? <span className="flex items-center gap-1 text-sm text-primary/70"><Trophy className="w-3 h-3" />{s.best_quality_model}</span>
        : <span className="text-sm text-muted-foreground/50">--</span>;
    },
  },
];

export function ArenaHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: ArenaHistoryProps) {
  const activeRun = useMemo(() => runs.find((r) => r.id === expandedRunId), [runs, expandedRunId]);

  return (
    <>
      <LabHistoryTable
        runs={runs}
        columns={COLUMNS}
        activeRunId={expandedRunId}
        onRowClick={(id) => onToggleExpand(expandedRunId === id ? null : id)}
        onDelete={onDelete}
        emptyIcon={FlaskConical}
        emptyTitle="No arena runs yet"
        emptySubtitle="Select models above and run a test"
        title="Arena History"
      />

      {activeRun && (
        <LabResultModal
          isOpen
          onClose={() => onToggleExpand(null)}
          run={activeRun}
          modeLabel="Arena"
          headerChips={
            <>
              <span className="text-xs text-muted-foreground/60">{parseModels(activeRun).join(', ')}</span>
              {activeRun.scenariosCount > 0 && <span className="text-xs text-muted-foreground/50">{activeRun.scenariosCount} scenarios</span>}
            </>
          }
        >
          <ArenaResultsView results={resultsMap[activeRun.id] ?? []} runId={activeRun.id} />
        </LabResultModal>
      )}
    </>
  );
}
