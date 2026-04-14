import { useMemo } from 'react';
import { GitBranch } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ImprovePromptButton } from '../shared/ImprovePromptButton';
import { ExportReportButton } from '../shared/ExportReportButton';
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

export function AbHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: AbHistoryProps) {
  const { t } = useTranslation();
  const activeRun = useMemo(() => runs.find((r) => r.id === expandedRunId), [runs, expandedRunId]);

  const columns: LabHistoryColumn<LabAbRun>[] = useMemo(() => [
    {
      key: 'versions',
      label: t.agents.lab.ab_comparison,
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
      label: t.agents.lab.ab_scenarios,
      className: 'w-[90px]',
      render: (run) => <span className="text-sm text-muted-foreground/80">{run.scenariosCount || '--'}</span>,
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
        emptyIcon={GitBranch}
        emptyTitle={t.agents.lab.ab_no_runs}
        emptySubtitle={t.agents.lab.ab_no_runs_subtitle}
        title={t.agents.lab.ab_history_title}
      />

      {activeRun && (
        <LabResultModal
          isOpen
          onClose={() => onToggleExpand(null)}
          run={activeRun}
          modeLabel={t.agents.lab.ab_mode_label}
          headerChips={
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-blue-500/15 text-blue-400">v{activeRun.versionANum}</span>
              <span className="text-muted-foreground/40 text-xs">vs</span>
              <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-violet-500/15 text-violet-400">v{activeRun.versionBNum}</span>
            </div>
          }
          footerActions={
            activeRun.status === 'completed' ? (
              <>
                <ExportReportButton mode="ab" run={activeRun} results={resultsMap[activeRun.id] ?? []} />
                <ImprovePromptButton personaId={activeRun.personaId} runId={activeRun.id} mode="ab" />
              </>
            ) : undefined
          }
        >
          <AbResultsView results={resultsMap[activeRun.id] ?? []} runId={activeRun.id} />
        </LabResultModal>
      )}
    </>
  );
}
