import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { compositeScore } from '@/lib/eval/evalFramework';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { useTranslation } from '@/i18n/useTranslation';

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

const SVG_W = 180;
const SVG_H = 64;
const PAD_X = 6;
const PAD_Y = 6;
const MAX_POINTS = 8;
const GRADIENT_ID = 'scoreTrendGrad';

function toSvgCoords(points: RunDataPoint[]): Array<{ x: number; y: number; dp: RunDataPoint }> {
  if (points.length === 0) return [];
  const minScore = Math.min(...points.map((p) => p.score));
  const maxScore = Math.max(...points.map((p) => p.score));
  const range = maxScore - minScore || 1;
  return points.map((dp, i) => ({
    x: PAD_X + (i / Math.max(points.length - 1, 1)) * (SVG_W - PAD_X * 2),
    y: PAD_Y + (1 - (dp.score - minScore) / range) * (SVG_H - PAD_Y * 2),
    dp,
  }));
}

export function ScoreTrendCard({ personaId }: ScoreTrendCardProps) {
  const { t } = useTranslation();
  const arenaRuns = useAgentStore((s) => s.arenaRuns);
  const abRuns = useAgentStore((s) => s.abRuns);
  const evalRuns = useAgentStore((s) => s.evalRuns);
  const matrixRuns = useAgentStore((s) => s.matrixRuns);
  const arenaResultsMap = useAgentStore((s) => s.arenaResultsMap);
  const abResultsMap = useAgentStore((s) => s.abResultsMap);
  const evalResultsMap = useAgentStore((s) => s.evalResultsMap);
  const matrixResultsMap = useAgentStore((s) => s.matrixResultsMap);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const dataPoints = useMemo(() => {
    const points: RunDataPoint[] = [];

    for (const run of arenaRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = arenaResultsMap[run.id] as LabArenaResult[] | undefined;
      if (!results?.length) continue;
      const score = avgComposite(results);
      if (score != null) points.push({ label: `${MODE_ABBR.arena} ${shortDate(run.createdAt)}`, score, date: run.createdAt });
    }

    for (const run of abRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = abResultsMap[run.id] as LabAbResult[] | undefined;
      if (!results?.length) continue;
      const score = avgComposite(results);
      if (score != null) points.push({ label: `${MODE_ABBR.ab} ${shortDate(run.createdAt)}`, score, date: run.createdAt });
    }

    for (const run of evalRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = evalResultsMap[run.id] as LabEvalResult[] | undefined;
      if (!results?.length) continue;
      const score = avgComposite(results);
      if (score != null) points.push({ label: `${MODE_ABBR.eval} ${shortDate(run.createdAt)}`, score, date: run.createdAt });
    }

    for (const run of matrixRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = matrixResultsMap[run.id] as LabMatrixResult[] | undefined;
      if (!results?.length) continue;
      const score = avgComposite(results);
      if (score != null) points.push({ label: `${MODE_ABBR.matrix} ${shortDate(run.createdAt)}`, score, date: run.createdAt });
    }

    points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return points.slice(-MAX_POINTS);
  }, [personaId, arenaRuns, abRuns, evalRuns, matrixRuns, arenaResultsMap, abResultsMap, evalResultsMap, matrixResultsMap]);

  const bestScore = useMemo(() => {
    if (dataPoints.length === 0) return null;
    return Math.max(...dataPoints.map((d) => d.score));
  }, [dataPoints]);

  const svgPoints = useMemo(() => toSvgCoords(dataPoints), [dataPoints]);

  if (dataPoints.length === 0) {
    return (
      <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-xs font-medium text-muted-foreground/60">{t.agents.lab.score_trend}</span>
        </div>
        <p className="text-xs text-muted-foreground/40">{t.agents.lab.run_tests_hint}</p>
      </div>
    );
  }

  const polylineStr = svgPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const first = svgPoints[0]!;
  const last = svgPoints[svgPoints.length - 1]!;
  const fillPath = svgPoints.length > 1
    ? `M${first.x},${SVG_H} ${svgPoints.map((p) => `L${p.x},${p.y}`).join(' ')} L${last.x},${SVG_H} Z`
    : '';

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-primary/70" />
        <span className="text-xs font-medium text-foreground/70">{t.agents.lab.score_trend}</span>
        {bestScore != null && (
          <span className="ml-auto text-xs text-emerald-400 font-medium">Best: {bestScore}</span>
        )}
      </div>

      {/* Sparkline */}
      <div className="space-y-1">
        <div className="relative" onMouseLeave={() => setHoveredIdx(null)}>
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full"
            style={{ height: 64 }}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Score trend: ${first.dp.score} to ${last.dp.score}, ${last.dp.score >= first.dp.score ? 'improving' : 'declining'}`}
          >
            <defs>
              <linearGradient id={GRADIENT_ID} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.10" />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {fillPath && (
              <path d={fillPath} fill={`url(#${GRADIENT_ID})`} />
            )}

            <polyline
              points={polylineStr}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {svgPoints.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r={hoveredIdx === i ? 3.5 : 2}
                fill={hoveredIdx === i ? 'var(--color-primary)' : 'var(--color-background)'}
                stroke="var(--color-primary)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer transition-[r] duration-150"
                onMouseEnter={() => setHoveredIdx(i)}
              />
            ))}
          </svg>

          {hoveredIdx != null && svgPoints[hoveredIdx] && (
            <div
              className="absolute bottom-full mb-1 -translate-x-1/2 pointer-events-none z-10 whitespace-nowrap rounded bg-popover border border-border px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-sm"
              style={{
                left: `${(svgPoints[hoveredIdx].x / SVG_W) * 100}%`,
              }}
            >
              {svgPoints[hoveredIdx].dp.label}: <span className="font-medium">{svgPoints[hoveredIdx].dp.score}</span>
            </div>
          )}
        </div>

        {/* Min/max labels below chart */}
        <div className="flex justify-between">
          <span className="text-xs text-foreground/50 tabular-nums">{first.dp.score}</span>
          <span className="text-xs text-foreground/50 tabular-nums">{last.dp.score}</span>
        </div>

        {/* Visually-hidden table fallback for screen readers */}
        <table className="sr-only">
          <caption>Score trend data points</caption>
          <thead><tr><th>Run</th><th>Score</th></tr></thead>
          <tbody>
            {dataPoints.map((dp, i) => (
              <tr key={i}><td>{dp.label}</td><td>{dp.score}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
