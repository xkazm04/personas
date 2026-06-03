import { useMemo } from 'react';
import { Grid3X3, Trophy } from 'lucide-react';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ImprovePromptButton } from '../shared/ImprovePromptButton';
import { ExportReportButton } from '../shared/ExportReportButton';
import { EvalResultsGrid } from './EvalResultsGrid';
import { buildEvalGridData } from '../../libs/evalAggregation';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import type { LabEvalRun } from '@/lib/bindings/LabEvalRun';
import { useTranslation } from '@/i18n/useTranslation';

function parseVersionNums(run: LabEvalRun): string {
  return run.versionNumbers.map((n) => `v${n}`).join(', ');
}

interface EvalHistoryProps {
  runs: LabEvalRun[];
  resultsMap: Record<string, LabEvalResult[]>;
  expandedRunId: string | null;
  onToggleExpand: (runId: string | null) => void;
  onDelete: (runId: string) => void;
}

export function EvalHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: EvalHistoryProps) {
  const { t } = useTranslation();
  const activeRun = useMemo(() => runs.find((r) => r.id === expandedRunId), [runs, expandedRunId]);

  // Winning version per completed run, so the leader is scannable without expanding.
  const winnerByRun = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const run of runs) {
      const res = run.status === 'completed' ? resultsMap[run.id] : undefined;
      if (!res?.length) { m[run.id] = null; continue; }
      const { versionAggs, winnerId } = buildEvalGridData(res);
      m[run.id] = versionAggs.find((a) => a.versionId === winnerId)?.versionNumber ?? null;
    }
    return m;
  }, [runs, resultsMap]);

  const columns: LabHistoryColumn<LabEvalRun>[] = useMemo(() => [
    {
      key: 'versions',
      label: t.agents.lab.versions_column,
      render: (run) => <span className="typo-code font-mono text-foreground">{parseVersionNums(run)}</span>,
    },
    {
      key: 'scenarios',
      label: t.agents.lab.scenarios_column,
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
        emptyIcon={Grid3X3}
        emptyTitle={t.agents.lab.no_eval_runs}
        emptySubtitle={t.agents.lab.no_eval_runs_subtitle}
        title={t.agents.lab.eval_history_title}
      />

      {activeRun && (
        <LabResultModal
          isOpen
          onClose={() => onToggleExpand(null)}
          run={activeRun}
          modeLabel={t.agents.lab.eval_mode_label}
          headerChips={
            <>
              <span className="typo-code font-mono text-foreground">{parseVersionNums(activeRun)}</span>
              {activeRun.scenariosCount > 0 && <span className="typo-caption text-foreground">{activeRun.scenariosCount} scenarios</span>}
            </>
          }
          footerActions={
            activeRun.status === 'completed' ? (
              <>
                <ExportReportButton mode="eval" run={activeRun} results={resultsMap[activeRun.id] ?? []} />
                <ImprovePromptButton personaId={activeRun.personaId} runId={activeRun.id} mode="eval" />
              </>
            ) : undefined
          }
        >
          <EvalResultsGrid results={resultsMap[activeRun.id] ?? []} runId={activeRun.id} loading={resultsMap[activeRun.id] === undefined} />
        </LabResultModal>
      )}
    </>
  );
}
