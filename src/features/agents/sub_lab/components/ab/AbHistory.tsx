import { useMemo } from 'react';
import { GitBranch, Trophy } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ImprovePromptButton } from '../shared/ImprovePromptButton';
import { ExportReportButton } from '../shared/ExportReportButton';
import { AbResultsView } from './AbResultsView';
import { aggregateAbResults } from '../../libs/labAggregation';
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

  // Winning version per completed run, so the leader is scannable without expanding.
  const winnerByRun = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const run of runs) {
      const res = run.status === 'completed' ? resultsMap[run.id] : undefined;
      if (!res?.length) { m[run.id] = null; continue; }
      const { versionAggs, winnerId } = aggregateAbResults(res);
      m[run.id] = versionAggs.find((a) => a.versionId === winnerId)?.versionNumber ?? null;
    }
    return m;
  }, [runs, resultsMap]);

  const columns: LabHistoryColumn<LabAbRun>[] = useMemo(() => [
    {
      key: 'versions',
      label: t.agents.lab.ab_comparison,
      render: (run) => (
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded typo-code font-mono bg-blue-500/15 text-blue-400">v{run.versionANum}</span>
          <span className="text-foreground typo-caption">vs</span>
          <span className="px-1.5 py-0.5 rounded typo-code font-mono bg-violet-500/15 text-violet-400">v{run.versionBNum}</span>
        </div>
      ),
    },
    {
      key: 'scenarios',
      label: t.agents.lab.ab_scenarios,
      className: 'w-[90px]',
      render: (run) => <span className="typo-body text-foreground">{run.scenariosCount || '--'}</span>,
    },
    {
      key: 'winner',
      label: t.agents.lab.winner,
      className: 'w-[80px]',
      render: (run) => {
        const v = winnerByRun[run.id];
        return v != null
          ? <span className="inline-flex items-center gap-1 typo-caption font-mono text-primary"><Trophy className="w-3 h-3" />v{v}</span>
          : <span className="text-foreground">&mdash;</span>;
      },
    },
  ], [t, winnerByRun]);

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
              <span className="px-1.5 py-0.5 rounded typo-code font-mono bg-blue-500/15 text-blue-400">v{activeRun.versionANum}</span>
              <span className="text-foreground typo-caption">vs</span>
              <span className="px-1.5 py-0.5 rounded typo-code font-mono bg-violet-500/15 text-violet-400">v{activeRun.versionBNum}</span>
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
          <AbResultsView results={resultsMap[activeRun.id] ?? []} runId={activeRun.id} loading={resultsMap[activeRun.id] === undefined} />
        </LabResultModal>
      )}
    </>
  );
}
