import { useMemo } from 'react';
import { GitBranch } from 'lucide-react';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { AbResultsView } from './AbResultsView';
import type { LabAbRun } from '@/lib/bindings/LabAbRun';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';

interface AbHistoryProps {
  runs: LabAbRun[];
  resultsMap: Record<string, LabAbResult[]>;
  expandedRunId: string | null;
  onToggleExpand: (runId: string | null) => void;
  onDelete: (runId: string) => void;
}

const COLUMNS: LabHistoryColumn<LabAbRun>[] = [
  {
    key: 'versions',
    label: 'Comparison',
    render: (run) => (
      <div className="flex items-center gap-1.5">
        <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-blue-500/15 text-blue-400">v{run.versionANum}</span>
        <span className="text-muted-foreground/40 text-xs">vs</span>
        <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-violet-500/15 text-violet-400">v{run.versionBNum}</span>
      </div>
    ),
  },
  {
    key: 'scenarios',
    label: 'Scenarios',
    className: 'w-[90px]',
    render: (run) => <span className="text-sm text-muted-foreground/80">{run.scenariosCount || '--'}</span>,
  },
];

export function AbHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: AbHistoryProps) {
  const activeRun = useMemo(() => runs.find((r) => r.id === expandedRunId), [runs, expandedRunId]);

  return (
    <>
      <LabHistoryTable
        runs={runs}
        columns={COLUMNS}
        activeRunId={expandedRunId}
        onRowClick={(id) => onToggleExpand(expandedRunId === id ? null : id)}
        onDelete={onDelete}
        emptyIcon={GitBranch}
        emptyTitle="No A/B test runs yet"
        emptySubtitle="Select two versions and run a comparison"
        title="A/B History"
      />

      {activeRun && (
        <LabResultModal
          isOpen
          onClose={() => onToggleExpand(null)}
          run={activeRun}
          modeLabel="A/B Test"
          headerChips={
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-blue-500/15 text-blue-400">v{activeRun.versionANum}</span>
              <span className="text-muted-foreground/40 text-xs">vs</span>
              <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-violet-500/15 text-violet-400">v{activeRun.versionBNum}</span>
            </div>
          }
        >
          <AbResultsView results={resultsMap[activeRun.id] ?? []} runId={activeRun.id} />
        </LabResultModal>
      )}
    </>
  );
}
