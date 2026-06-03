import { useMemo } from 'react';
import { FlaskConical, Trophy, Target, FileText, Shield } from 'lucide-react';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ImprovePromptButton } from '../shared/ImprovePromptButton';
import { ExportReportButton } from '../shared/ExportReportButton';
import { ArenaResultsView } from './ArenaResultsView';
import { compositeScoreFromRow, scoreColor } from '@/lib/eval/evalFramework';
import type { LabArenaRun } from '@/lib/bindings/LabArenaRun';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { useTranslation } from '@/i18n/useTranslation';
import { debtText } from '@/i18n/DebtText';


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
  return run.modelsTested ?? [];
}

function computeWinnerScore(results: LabArenaResult[] | undefined): { ta: number; oq: number; pc: number; comp: number } | null {
  if (!results || results.length === 0) return null;
  // Group by model, find best composite. Each metric is averaged independently
  // over rows where it was scored — null is "not scored", not "scored zero".
  interface PerModel { taSum: number; taCount: number; oqSum: number; oqCount: number; pcSum: number; pcCount: number; }
  const modelScores = new Map<string, PerModel>();
  for (const r of results) {
    if (!modelScores.has(r.modelId)) modelScores.set(r.modelId, { taSum: 0, taCount: 0, oqSum: 0, oqCount: 0, pcSum: 0, pcCount: 0 });
    const m = modelScores.get(r.modelId)!;
    if (r.toolAccuracyScore != null) { m.taSum += r.toolAccuracyScore; m.taCount++; }
    if (r.outputQualityScore != null) { m.oqSum += r.outputQualityScore; m.oqCount++; }
    if (r.protocolCompliance != null) { m.pcSum += r.protocolCompliance; m.pcCount++; }
  }
  let best: { ta: number; oq: number; pc: number; comp: number } | null = null;
  for (const [, m] of modelScores) {
    const ta = m.taCount > 0 ? Math.round(m.taSum / m.taCount) : null;
    const oq = m.oqCount > 0 ? Math.round(m.oqSum / m.oqCount) : null;
    const pc = m.pcCount > 0 ? Math.round(m.pcSum / m.pcCount) : null;
    const comp = compositeScoreFromRow(ta, oq, pc);
    if (comp == null) continue;
    if (!best || comp > best.comp) best = { ta: ta ?? 0, oq: oq ?? 0, pc: pc ?? 0, comp };
  }
  return best;
}

function buildColumns(t: ReturnType<typeof useTranslation>['t'], resultsMap: Record<string, LabArenaResult[]>): LabHistoryColumn<LabArenaRun>[] {
  return [
    {
      key: 'models',
      label: t.agents.lab.models_column,
      render: (run) => (
        <span className="typo-body text-foreground font-medium">{parseModels(run).join(', ') || '--'}</span>
      ),
    },
    {
      key: 'scenarios',
      label: t.agents.lab.scenarios_column,
      className: 'w-[70px]',
      render: (run) => <span className="typo-body text-foreground">{run.scenariosCount || '--'}</span>,
    },
    {
      key: 'best',
      label: t.agents.lab.best_column,
      className: 'w-[100px]',
      render: (run) => {
        const s = parseSummary(run);
        return s?.best_quality_model
          ? <span className="flex items-center gap-1 typo-body text-primary/70"><Trophy className="w-3 h-3" />{s.best_quality_model}</span>
          : <span className="typo-body text-foreground">--</span>;
      },
    },
    {
      key: 'scores',
      label: t.agents.lab.winner_scores,
      className: 'w-[200px]',
      render: (run) => {
        const scores = computeWinnerScore(resultsMap[run.id]);
        if (!scores) return <span className="typo-body text-foreground">--</span>;
        return (
          <div className="flex items-center gap-2.5 typo-caption">
            <span className={`font-bold ${scoreColor(scores.comp)}`}>{scores.comp}</span>
            <span className="text-foreground">|</span>
            <span className="flex items-center gap-0.5" title={debtText("auto_tool_accuracy_aeba854a")}><Target className="w-2.5 h-2.5 text-foreground" /><span className={scoreColor(scores.ta)}>{scores.ta}</span></span>
            <span className="flex items-center gap-0.5" title={debtText("auto_output_quality_9ae643ed")}><FileText className="w-2.5 h-2.5 text-foreground" /><span className={scoreColor(scores.oq)}>{scores.oq}</span></span>
            <span className="flex items-center gap-0.5" title="Protocol"><Shield className="w-2.5 h-2.5 text-foreground" /><span className={scoreColor(scores.pc)}>{scores.pc}</span></span>
          </div>
        );
      },
    },
  ];
}

export function ArenaHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: ArenaHistoryProps) {
  const { t } = useTranslation();
  const activeRun = useMemo(() => runs.find((r) => r.id === expandedRunId), [runs, expandedRunId]);
  const columns = useMemo(() => buildColumns(t, resultsMap), [t, resultsMap]);

  return (
    <>
      <LabHistoryTable
        runs={runs}
        columns={columns}
        activeRunId={expandedRunId}
        onRowClick={(id) => onToggleExpand(expandedRunId === id ? null : id)}
        onDelete={onDelete}
        emptyIcon={FlaskConical}
        emptyTitle={t.agents.lab.no_arena_runs}
        emptySubtitle={t.agents.lab.no_arena_runs_subtitle}
        title={t.agents.lab.arena_history_title}
      />

      {activeRun && (
        <LabResultModal
          isOpen
          onClose={() => onToggleExpand(null)}
          run={activeRun}
          modeLabel={t.agents.lab.arena_mode_label}
          headerChips={
            <>
              <span className="typo-caption text-foreground">{parseModels(activeRun).join(', ')}</span>
              {activeRun.scenariosCount > 0 && <span className="typo-caption text-foreground">{activeRun.scenariosCount} scenarios</span>}
            </>
          }
          footerActions={
            activeRun.status === 'completed' ? (
              <>
                <ExportReportButton mode="arena" run={activeRun} results={resultsMap[activeRun.id] ?? []} />
                <ImprovePromptButton personaId={activeRun.personaId} runId={activeRun.id} mode="arena" />
              </>
            ) : undefined
          }
        >
          <ArenaResultsView results={resultsMap[activeRun.id] ?? []} runId={activeRun.id} llmSummary={activeRun.llmSummary ?? undefined} loading={resultsMap[activeRun.id] === undefined} />
        </LabResultModal>
      )}
    </>
  );
}
