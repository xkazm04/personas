import { useMemo } from 'react';
import { FlaskConical, Trophy, Target, FileText, Shield } from 'lucide-react';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ImprovePromptButton } from '../shared/ImprovePromptButton';
import { ExportReportButton } from '../shared/ExportReportButton';
import { ArenaResultsView } from './ArenaResultsView';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import type { LabArenaRun } from '@/lib/bindings/LabArenaRun';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { useTranslation } from '@/i18n/useTranslation';

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
  // Group by model, find best composite
  const modelScores = new Map<string, { ta: number; oq: number; pc: number; count: number }>();
  for (const r of results) {
    if (!modelScores.has(r.modelId)) modelScores.set(r.modelId, { ta: 0, oq: 0, pc: 0, count: 0 });
    const m = modelScores.get(r.modelId)!;
    m.ta += r.toolAccuracyScore ?? 0;
    m.oq += r.outputQualityScore ?? 0;
    m.pc += r.protocolCompliance ?? 0;
    m.count++;
  }
  let best: { ta: number; oq: number; pc: number; comp: number } | null = null;
  for (const [, m] of modelScores) {
    const ta = Math.round(m.ta / m.count);
    const oq = Math.round(m.oq / m.count);
    const pc = Math.round(m.pc / m.count);
    const comp = compositeScore(ta, oq, pc);
    if (!best || comp > best.comp) best = { ta, oq, pc, comp };
  }
  return best;
}

function buildColumns(t: ReturnType<typeof useTranslation>['t'], resultsMap: Record<string, LabArenaResult[]>): LabHistoryColumn<LabArenaRun>[] {
  return [
    {
      key: 'models',
      label: t.agents.lab.models_column,
      render: (run) => (
        <span className="text-sm text-foreground font-medium">{parseModels(run).join(', ') || '--'}</span>
      ),
    },
    {
      key: 'scenarios',
      label: t.agents.lab.scenarios_column,
      className: 'w-[70px]',
      render: (run) => <span className="text-sm text-foreground">{run.scenariosCount || '--'}</span>,
    },
    {
      key: 'best',
      label: t.agents.lab.best_column,
      className: 'w-[100px]',
      render: (run) => {
        const s = parseSummary(run);
        return s?.best_quality_model
          ? <span className="flex items-center gap-1 text-sm text-primary/70"><Trophy className="w-3 h-3" />{s.best_quality_model}</span>
          : <span className="text-sm text-foreground">--</span>;
      },
    },
    {
      key: 'scores',
      label: t.agents.lab.winner_scores,
      className: 'w-[200px]',
      render: (run) => {
        const scores = computeWinnerScore(resultsMap[run.id]);
        if (!scores) return <span className="text-sm text-foreground">--</span>;
        return (
          <div className="flex items-center gap-2.5 text-xs">
            <span className={`font-bold ${scoreColor(scores.comp)}`}>{scores.comp}</span>
            <span className="text-foreground">|</span>
            <span className="flex items-center gap-0.5" title="Tool Accuracy"><Target className="w-2.5 h-2.5 text-foreground" /><span className={scoreColor(scores.ta)}>{scores.ta}</span></span>
            <span className="flex items-center gap-0.5" title="Output Quality"><FileText className="w-2.5 h-2.5 text-foreground" /><span className={scoreColor(scores.oq)}>{scores.oq}</span></span>
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
              <span className="text-xs text-foreground">{parseModels(activeRun).join(', ')}</span>
              {activeRun.scenariosCount > 0 && <span className="text-xs text-foreground">{activeRun.scenariosCount} scenarios</span>}
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
          <ArenaResultsView results={resultsMap[activeRun.id] ?? []} runId={activeRun.id} llmSummary={activeRun.llmSummary ?? undefined} />
        </LabResultModal>
      )}
    </>
  );
}
