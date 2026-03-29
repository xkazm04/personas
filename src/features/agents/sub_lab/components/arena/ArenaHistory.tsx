import { useMemo } from 'react';
import { FlaskConical, Trophy, Target, FileText, Shield } from 'lucide-react';
import { LabHistoryTable, type LabHistoryColumn } from '../shared/LabHistoryTable';
import { LabResultModal } from '../shared/LabResultModal';
import { ImprovePromptButton } from '../shared/ImprovePromptButton';
import { ArenaResultsView } from './ArenaResultsView';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
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

function buildColumns(resultsMap: Record<string, LabArenaResult[]>): LabHistoryColumn<LabArenaRun>[] {
  return [
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
      className: 'w-[70px]',
      render: (run) => <span className="text-sm text-muted-foreground/80">{run.scenariosCount || '--'}</span>,
    },
    {
      key: 'best',
      label: 'Best',
      className: 'w-[100px]',
      render: (run) => {
        const s = parseSummary(run);
        return s?.best_quality_model
          ? <span className="flex items-center gap-1 text-sm text-primary/70"><Trophy className="w-3 h-3" />{s.best_quality_model}</span>
          : <span className="text-sm text-muted-foreground/50">--</span>;
      },
    },
    {
      key: 'scores',
      label: 'Winner Scores',
      className: 'w-[200px]',
      render: (run) => {
        const scores = computeWinnerScore(resultsMap[run.id]);
        if (!scores) return <span className="text-sm text-muted-foreground/30">--</span>;
        return (
          <div className="flex items-center gap-2.5 text-xs">
            <span className={`font-bold ${scoreColor(scores.comp)}`}>{scores.comp}</span>
            <span className="text-muted-foreground/30">|</span>
            <span className="flex items-center gap-0.5" title="Tool Accuracy"><Target className="w-2.5 h-2.5 text-muted-foreground/50" /><span className={scoreColor(scores.ta)}>{scores.ta}</span></span>
            <span className="flex items-center gap-0.5" title="Output Quality"><FileText className="w-2.5 h-2.5 text-muted-foreground/50" /><span className={scoreColor(scores.oq)}>{scores.oq}</span></span>
            <span className="flex items-center gap-0.5" title="Protocol"><Shield className="w-2.5 h-2.5 text-muted-foreground/50" /><span className={scoreColor(scores.pc)}>{scores.pc}</span></span>
          </div>
        );
      },
    },
  ];
}

export function ArenaHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: ArenaHistoryProps) {
  const activeRun = useMemo(() => runs.find((r) => r.id === expandedRunId), [runs, expandedRunId]);
  const columns = useMemo(() => buildColumns(resultsMap), [resultsMap]);

  return (
    <>
      <LabHistoryTable
        runs={runs}
        columns={columns}
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
          footerActions={
            activeRun.status === 'completed' ? (
              <ImprovePromptButton personaId={activeRun.personaId} runId={activeRun.id} mode="arena" />
            ) : undefined
          }
        >
          <ArenaResultsView results={resultsMap[activeRun.id] ?? []} runId={activeRun.id} llmSummary={activeRun.llmSummary ?? undefined} />
        </LabResultModal>
      )}
    </>
  );
}
