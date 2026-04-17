import { useMemo } from 'react';
import { Wand2, Check } from 'lucide-react';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ImprovePromptButton } from '../shared/ImprovePromptButton';
import { ExportReportButton } from '../shared/ExportReportButton';
import { MatrixResultsView } from './MatrixResultsView';
import type { LabMatrixRun } from '@/lib/bindings/LabMatrixRun';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';
import { useTranslation } from '@/i18n/useTranslation';

interface MatrixHistoryProps {
  runs: LabMatrixRun[];
  resultsMap: Record<string, LabMatrixResult[]>;
  expandedRunId: string | null;
  onToggleExpand: (runId: string | null) => void;
  onDelete: (runId: string) => void;
}

export function MatrixHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: MatrixHistoryProps) {
  const { t } = useTranslation();
  const activeRun = useMemo(() => runs.find((r) => r.id === expandedRunId), [runs, expandedRunId]);

  const columns: LabHistoryColumn<LabMatrixRun>[] = useMemo(() => [
    {
      key: 'instruction',
      label: t.agents.lab.instruction_column,
      render: (run) => (
        <span className="typo-body text-foreground truncate block max-w-[350px]">{run.userInstruction}</span>
      ),
    },
    {
      key: 'accepted',
      label: t.agents.lab.draft_column,
      className: 'w-[100px]',
      render: (run) =>
        run.draftAccepted
          ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card typo-caption font-medium bg-emerald-500/15 text-emerald-400"><Check className="w-2.5 h-2.5" />{t.agents.lab.accepted_label}</span>
          : <span className="typo-caption text-foreground">{t.agents.lab.pending_label}</span>,
    },
  ], [t]);

  return (
    <>
      <LabHistoryTable
        runs={runs}
        columns={columns}
        activeRunId={expandedRunId}
        onRowClick={(id) => onToggleExpand(expandedRunId === id ? null : id)}
        onDelete={onDelete}
        emptyIcon={Wand2}
        emptyTitle={t.agents.lab.no_matrix_runs}
        emptySubtitle={t.agents.lab.no_matrix_runs_subtitle}
        title={t.agents.lab.matrix_history_title}
      />

      {activeRun && (
        <LabResultModal
          isOpen
          onClose={() => onToggleExpand(null)}
          run={activeRun}
          modeLabel={t.agents.lab.matrix_mode_label}
          headerChips={
            <span className="typo-caption text-foreground truncate max-w-[300px]">{activeRun.userInstruction}</span>
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
