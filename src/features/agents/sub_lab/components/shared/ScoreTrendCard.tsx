import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { compositeScore } from '@/lib/eval/evalFramework';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';


interface ScoreTrendCardProps {
  personaId: string;
}

type TrendMode = 'arena' | 'ab' | 'eval' | 'matrix';

interface RunDataPoint {
  label: string;
  score: number;
  date: string;
  mode: TrendMode;
  runId: string;
}

const MODE_ABBR: Record<TrendMode, string> = {
  arena: 'AR',
  ab: 'AB',
  eval: 'EV',
  matrix: 'MX',
};

const MODE_ORDER: TrendMode[] = ['arena', 'ab', 'eval', 'matrix'];

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
  const setLabMode = useAgentStore((s) => s.setLabMode);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [hiddenModes, setHiddenModes] = useState<Set<TrendMode>>(new Set());

  // Every scored, completed run for this persona across the four scoring modes.
  const allPoints = useMemo(() => {
    const points: RunDataPoint[] = [];
    const push = (mode: TrendMode, runId: string, createdAt: string, score: number | null) => {
      if (score != null) points.push({ label: `${MODE_ABBR[mode]} ${shortDate(createdAt)}`, score, date: createdAt, mode, runId });
    };

    for (const run of arenaRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = arenaResultsMap[run.id] as LabArenaResult[] | undefined;
      if (results?.length) push('arena', run.id, run.createdAt, avgComposite(results));
    }
    for (const run of abRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = abResultsMap[run.id] as LabAbResult[] | undefined;
      if (results?.length) push('ab', run.id, run.createdAt, avgComposite(results));
    }
    for (const run of evalRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = evalResultsMap[run.id] as LabEvalResult[] | undefined;
      if (results?.length) push('eval', run.id, run.createdAt, avgComposite(results));
    }
    for (const run of matrixRuns) {
      if (run.personaId !== personaId || run.status !== 'completed') continue;
      const results = matrixResultsMap[run.id] as LabMatrixResult[] | undefined;
      if (results?.length) push('matrix', run.id, run.createdAt, avgComposite(results));
    }

    points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return points;
  }, [personaId, arenaRuns, abRuns, evalRuns, matrixRuns, arenaResultsMap, abResultsMap, evalResultsMap, matrixResultsMap]);

  // Only modes that actually have data get a filter chip.
  const availableModes = useMemo(
    () => MODE_ORDER.filter((m) => allPoints.some((p) => p.mode === m)),
    [allPoints],
  );

  const dataPoints = useMemo(
    () => allPoints.filter((p) => !hiddenModes.has(p.mode)).slice(-MAX_POINTS),
    [allPoints, hiddenModes],
  );

  // Map plotted points to SVG coords once, deriving the average line from the same scale.
  const { svgPoints, avgY, bestScore } = useMemo(() => {
    const empty = { svgPoints: [] as Array<{ x: number; y: number; dp: RunDataPoint }>, avgY: null as number | null, bestScore: null as number | null };
    if (dataPoints.length === 0) return empty;
    const scores = dataPoints.map((p) => p.score);
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    const range = maxS - minS || 1;
    const mapY = (s: number) => PAD_Y + (1 - (s - minS) / range) * (SVG_H - PAD_Y * 2);
    const pts = dataPoints.map((dp, i) => ({
      x: PAD_X + (i / Math.max(dataPoints.length - 1, 1)) * (SVG_W - PAD_X * 2),
      y: mapY(dp.score),
      dp,
    }));
    const mean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return { svgPoints: pts, avgY: mapY(mean), bestScore: maxS };
  }, [dataPoints]);

  const toggleMode = (mode: TrendMode) => {
    setHiddenModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode); else next.add(mode);
      return next;
    });
  };

  if (allPoints.length === 0) {
    return (
      <div className="rounded-modal border border-primary/10 bg-secondary/20 p-3">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-3.5 h-3.5 text-foreground" />
          <span className="typo-caption font-medium text-foreground">{t.agents.lab.score_trend}</span>
        </div>
        <p className="typo-caption text-foreground">{t.agents.lab.run_tests_hint}</p>
      </div>
    );
  }

  const polylineStr = svgPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const first = svgPoints[0];
  const last = svgPoints[svgPoints.length - 1];
  const fillPath = svgPoints.length > 1 && first && last
    ? `M${first.x},${SVG_H} ${svgPoints.map((p) => `L${p.x},${p.y}`).join(' ')} L${last.x},${SVG_H} Z`
    : '';

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-primary/70" />
        <span className="typo-caption font-medium text-foreground">{t.agents.lab.score_trend}</span>
        {bestScore != null && (
          <span className="ml-auto typo-caption text-emerald-400 font-medium"><DebtText k="auto_best_33abaf20" /> {bestScore}</span>
        )}
      </div>

      {/* Mode filter chips — only modes with data; click to show/hide that run type. */}
      {availableModes.length > 1 && (
        <div className="flex items-center gap-1">
          {availableModes.map((mode) => {
            const active = !hiddenModes.has(mode);
            return (
              <button
                key={mode}
                onClick={() => toggleMode(mode)}
                aria-pressed={active}
                className={`px-1.5 py-0.5 rounded-input typo-caption font-mono font-medium transition-colors ${
                  active ? 'bg-primary/12 text-primary' : 'text-foreground/50 hover:text-foreground'
                }`}
              >
                {MODE_ABBR[mode]}
              </button>
            );
          })}
        </div>
      )}

      {svgPoints.length === 0 ? (
        <p className="typo-caption text-foreground py-3 text-center">{t.agents.lab.run_tests_hint}</p>
      ) : (
        <div className="space-y-1">
          <div className="relative" onMouseLeave={() => setHoveredIdx(null)}>
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="w-full"
              style={{ height: 64 }}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Score trend: ${first?.dp.score} to ${last?.dp.score}, ${(last?.dp.score ?? 0) >= (first?.dp.score ?? 0) ? 'improving' : 'declining'}`}
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

              {/* Average reference line — where this run-set sits on balance. */}
              {avgY != null && svgPoints.length > 1 && (
                <line
                  x1={PAD_X}
                  x2={SVG_W - PAD_X}
                  y1={avgY}
                  y2={avgY}
                  stroke="var(--color-foreground)"
                  strokeOpacity="0.25"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
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

              {svgPoints.map((pt, i) => {
                const isBest = bestScore != null && pt.dp.score === bestScore;
                return (
                  <circle
                    key={i}
                    cx={pt.x}
                    cy={pt.y}
                    r={hoveredIdx === i ? 3.5 : isBest ? 2.6 : 2}
                    fill={hoveredIdx === i || isBest ? 'var(--color-primary)' : 'var(--color-background)'}
                    stroke="var(--color-primary)"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer transition-[r] duration-150"
                    onMouseEnter={() => setHoveredIdx(i)}
                    onClick={() => setLabMode(pt.dp.mode)}
                  />
                );
              })}
            </svg>

            {hoveredIdx != null && svgPoints[hoveredIdx] && (
              <div
                className="absolute bottom-full mb-1 -translate-x-1/2 pointer-events-none z-10 whitespace-nowrap rounded bg-popover border border-border px-1.5 py-0.5 typo-caption text-popover-foreground shadow-elevation-1"
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
            <span className="typo-caption text-foreground tabular-nums">{first?.dp.score}</span>
            <span className="typo-caption text-foreground tabular-nums">{last?.dp.score}</span>
          </div>

          {/* Visually-hidden table fallback for screen readers */}
          <table className="sr-only">
            <caption><DebtText k="auto_score_trend_data_points_adfed6de" /></caption>
            <thead><tr><th>Run</th><th>Score</th></tr></thead>
            <tbody>
              {dataPoints.map((dp, i) => (
                <tr key={i}><td>{dp.label}</td><td>{dp.score}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
