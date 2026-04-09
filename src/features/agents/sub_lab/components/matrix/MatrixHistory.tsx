import { useMemo } from 'react';
import { Wand2, Check } from 'lucide-react';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ImprovePromptButton } from '../shared/ImprovePromptButton';
import { ExportReportButton } from '../shared/ExportReportButton';
import { MatrixResultsView } from './MatrixResultsView';
import type { LabMatrixRun } from '@/lib/bindings/LabMatrixRun';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';

interface MatrixHistoryProps {
  runs: LabMatrixRun[];
  resultsMap: Record<string, LabMatrixResult[]>;
  expandedRunId: string | null;
  onToggleExpand: (runId: string | null) => void;
  onDelete: (runId: string) => void;
}

const COLUMNS: LabHistoryColumn<LabMatrixRun>[] = [
  {
    key: 'instruction',
    label: 'Instruction',
    render: (run) => (
      <span className="text-sm text-foreground/80 truncate block max-w-[350px]">{run.userInstruction}</span>
    ),
  },
  {
    key: 'accepted',
    label: 'Draft',
    className: 'w-[100px]',
    render: (run) =>
      run.draftAccepted
        ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400"><Check className="w-2.5 h-2.5" />Accepted</span>
        : <span className="text-xs text-muted-foreground/50">Pending</span>,
  },
];

export function MatrixHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: MatrixHistoryProps) {
  const activeRun = useMemo(() => runs.find((r) => r.id === expandedRunId), [runs, expandedRunId]);

  return (
    <>
      <LabHistoryTable
        runs={runs}
        columns={COLUMNS}
        activeRunId={expandedRunId}
        onRowClick={(id) => onToggleExpand(expandedRunId === id ? null : id)}
        onDelete={onDelete}
        emptyIcon={Wand2}
        emptyTitle="No matrix runs yet"
        emptySubtitle="Describe a change above to generate and test a draft"
        title="Matrix History"
      />

      {activeRun && (
        <LabResultModal
          isOpen
          onClose={() => onToggleExpand(null)}
          run={activeRun}
          modeLabel="Matrix"
          headerChips={
            <span className="text-xs text-muted-foreground/60 truncate max-w-[300px]">{activeRun.userInstruction}</span>
          }
          footerActions={
            activeRun.status === 'completed' ? (
              <>
                <ExportReportButton mode="matrix" run={activeRun} results={resultsMap[activeRun.id] ?? []} />
                <ImprovePromptButton personaId={activeRun.personaId} runId={activeRun.id} mode="matrix" />
              </>
            ) : undefined
          }
        >
          <MatrixResultsView run={activeRun} results={resultsMap[activeRun.id] ?? []} />
        </LabResultModal>
      )}
    </>
  );
}
