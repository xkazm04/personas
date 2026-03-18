import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { compositeScore } from '@/lib/eval/evalFramework';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';

interface ScoreTrendCardProps {
  personaId: string;
}

interface RunDataPoint {
  label: string;
  score: number;
  date: string;
}

const MODE_ABBR: Record<string, string> = {
  arena: 'AR',
  ab: 'AB',
  eval: 'EV',
  matrix: 'MX',
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function avgComposite(results: Array<{ toolAccuracyScore: number | null; outputQualityScore: number | null; protocolCompliance: number | null }>): number | null {
  const scored = results.filter(
    (r) => r.toolAccuracyScore != null && r.outputQualityScore != null && r.protocolCompliance != null,
  );
  if (scored.length === 0) return null;
  const sum = scored.reduce(
    (acc, r) => acc + compositeScore(r.toolAccuracyScore!, r.outputQualityScore!, r.protocolCompliance!),
    0,
  );
  return Math.round(sum / scored.length);
}

function barColor(score: number): string {
  if (score >= 80) return 'bg-emerald-400';
  if (score >= 50) return 'bg-amber-400';
  return 'bg-red-400';
}

const MAX_BARS = 8;

export function ScoreTrendCard({ personaId }: ScoreTrendCardProps) {
  const arenaRuns = useAgentStore((s) => s.arenaRuns);
  const abRuns = useAgentStore((s) => s.abRuns);
  const evalRuns = useAgentStore((s) => s.evalRuns);
  const matrixRuns = useAgentStore((s) => s.matrixRuns);
  const arenaResultsMap = useAgentStore((s) => s.arenaResultsMap);
  const abResultsMap = useAgentStore((s) => s.abResultsMap);
  const evalResultsMap = useAgentStore((s) => s.evalResultsMap);
  const matrixResultsMap = useAgentStore((s) => s.matrixResultsMap);

  const dataPoints = useMemo(() => {
    const points: RunDataPoint[] = [];

    // Arena runs
    for (const run of arenaRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = arenaResultsMap[run.id] as LabArenaResult[] | undefined;
      if (!results?.length) continue;
      const score = avgComposite(results);
      if (score != null) points.push({ label: `${MODE_ABBR.arena} ${shortDate(run.createdAt)}`, score, date: run.createdAt });
    }

    // A/B runs
    for (const run of abRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = abResultsMap[run.id] as LabAbResult[] | undefined;
      if (!results?.length) continue;
      const score = avgComposite(results);
      if (score != null) points.push({ label: `${MODE_ABBR.ab} ${shortDate(run.createdAt)}`, score, date: run.createdAt });
    }

    // Eval runs
    for (const run of evalRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = evalResultsMap[run.id] as LabEvalResult[] | undefined;
      if (!results?.length) continue;
      const score = avgComposite(results);
      if (score != null) points.push({ label: `${MODE_ABBR.eval} ${shortDate(run.createdAt)}`, score, date: run.createdAt });
    }

    // Matrix runs
    for (const run of matrixRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = matrixResultsMap[run.id] as LabMatrixResult[] | undefined;
      if (!results?.length) continue;
      const score = avgComposite(results);
      if (score != null) points.push({ label: `${MODE_ABBR.matrix} ${shortDate(run.createdAt)}`, score, date: run.createdAt });
    }

    // Sort by date ascending, take last N
    points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return points.slice(-MAX_BARS);
  }, [personaId, arenaRuns, abRuns, evalRuns, matrixRuns, arenaResultsMap, abResultsMap, evalResultsMap, matrixResultsMap]);

  const bestScore = useMemo(() => {
    if (dataPoints.length === 0) return null;
    return Math.max(...dataPoints.map((d) => d.score));
  }, [dataPoints]);

  if (dataPoints.length === 0) {
    return (
      <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-xs font-medium text-muted-foreground/60">Score Trend</span>
        </div>
        <p className="text-xs text-muted-foreground/40">Run tests to see score trends</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-primary/70" />
        <span className="text-xs font-medium text-foreground/70">Score Trend</span>
        {bestScore != null && (
          <span className="ml-auto text-xs text-emerald-400 font-medium">Best: {bestScore}</span>
        )}
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-16">
        {dataPoints.map((dp, i) => {
          const height = Math.max(dp.score, 4); // min 4% height for visibility
          const isBest = dp.score === bestScore;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
              <span className="text-[9px] text-muted-foreground/60 tabular-nums">{dp.score}</span>
              <div className="w-full flex items-end" style={{ height: '40px' }}>
                <div
                  className={`w-full rounded-sm transition-all ${barColor(dp.score)} ${isBest ? 'ring-1 ring-emerald-400/40' : ''}`}
                  style={{ height: `${height * 0.4}px`, minHeight: '2px' }}
                  title={`${dp.label}: ${dp.score}`}
                />
              </div>
              <span className="text-[8px] text-muted-foreground/40 truncate w-full text-center leading-tight">{dp.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
