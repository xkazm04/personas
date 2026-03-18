import { useMemo } from 'react';
import { Grid3X3 } from 'lucide-react';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ImprovePromptButton } from '../shared/ImprovePromptButton';
import { EvalResultsGrid } from './EvalResultsGrid';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import type { LabEvalRun } from '@/lib/bindings/LabEvalRun';

function parseVersionNums(run: LabEvalRun): string {
  try { return (JSON.parse(run.versionNumbers) as number[]).map((n) => `v${n}`).join(', '); }
  catch { return run.versionNumbers; }
}

interface EvalHistoryProps {
  runs: LabEvalRun[];
  resultsMap: Record<string, LabEvalResult[]>;
  expandedRunId: string | null;
  onToggleExpand: (runId: string | null) => void;
  onDelete: (runId: string) => void;
}

const COLUMNS: LabHistoryColumn<LabEvalRun>[] = [
  {
    key: 'versions',
    label: 'Versions',
    render: (run) => <span className="text-sm font-mono text-foreground/80">{parseVersionNums(run)}</span>,
  },
  {
    key: 'scenarios',
    label: 'Scenarios',
    className: 'w-[90px]',
    render: (run) => <span className="text-sm text-muted-foreground/80">{run.scenariosCount || '--'}</span>,
  },
];

export function EvalHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: EvalHistoryProps) {
  const activeRun = useMemo(() => runs.find((r) => r.id === expandedRunId), [runs, expandedRunId]);

  return (
    <>
      <LabHistoryTable
        runs={runs}
        columns={COLUMNS}
        activeRunId={expandedRunId}
        onRowClick={(id) => onToggleExpand(expandedRunId === id ? null : id)}
        onDelete={onDelete}
        emptyIcon={Grid3X3}
        emptyTitle="No evaluation runs yet"
        emptySubtitle="Select versions and models, then run"
        title="Eval History"
      />

      {activeRun && (
        <LabResultModal
          isOpen
          onClose={() => onToggleExpand(null)}
          run={activeRun}
          modeLabel="Evaluation"
          headerChips={
            <>
              <span className="text-xs font-mono text-muted-foreground/60">{parseVersionNums(activeRun)}</span>
              {activeRun.scenariosCount > 0 && <span className="text-xs text-muted-foreground/50">{activeRun.scenariosCount} scenarios</span>}
            </>
          }
          footerActions={
            activeRun.status === 'completed' ? (
              <ImprovePromptButton personaId={activeRun.personaId} runId={activeRun.id} mode="eval" />
            ) : undefined
          }
        >
          <EvalResultsGrid results={resultsMap[activeRun.id] ?? []} runId={activeRun.id} />
        </LabResultModal>
      )}
    </>
  );
}
