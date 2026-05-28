import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Compact 0-5 Director-score trend for a persona row. Renders nothing when
 * there are no scores yet, a single coloured chip when there is one score,
 * and an SVG sparkline + latest-score chip when there are two or more.
 *
 * The sparkline is anchored to the fixed 0-5 score range (not min/max of the
 * sample) so two personas' lines are visually comparable at a glance — a 4
 * sits in the same spot whether the trend was 1→4 or 4→4.
 */

const W = 56;
const H = 16;
const PAD = 1.5;
const SCORE_MAX = 5;

function scoreTone(score: number): { stroke: string; fill: string; label: string } {
  if (score >= 4) return { stroke: 'var(--status-success)', fill: 'var(--status-success)', label: 'high' };
  if (score >= 2) return { stroke: 'var(--status-warning)', fill: 'var(--status-warning)', label: 'mid' };
  return { stroke: 'var(--status-error)', fill: 'var(--status-error)', label: 'low' };
}

function Sparkline({ scores }: { scores: number[] }) {
  const points = scores
    .map((s, i) => {
      const x = PAD + (i / (scores.length - 1)) * (W - PAD * 2);
      const y = H - PAD - (s / SCORE_MAX) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = scores[scores.length - 1]!;
  const tone = scoreTone(last);
  const lastX = PAD + (W - PAD * 2);
  const lastY = H - PAD - (last / SCORE_MAX) * (H - PAD * 2);
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="inline-block align-middle flex-shrink-0"
      data-testid="verdict-trend-sparkline"
    >
      {/* faint baseline at score 0 */}
      <line x1={0} y1={H - PAD} x2={W} y2={H - PAD} stroke="var(--border)" strokeWidth="0.5" />
      <polyline
        points={points}
        fill="none"
        stroke={tone.stroke}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r="1.6" fill={tone.fill} />
    </svg>
  );
}

export function VerdictTrendCell({ scores }: { scores: number[] | undefined }) {
  const { t } = useTranslation();
  const list = scores ?? [];

  if (list.length === 0) {
    return <span className="typo-caption text-foreground/35">—</span>;
  }

  const latest = list[list.length - 1]!;
  const tone = scoreTone(latest);

  if (list.length === 1) {
    return (
      <Tooltip content={t.director.col_verdict_tooltip}>
        <span
          className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded text-[11px] tabular-nums"
          style={{ color: tone.stroke, backgroundColor: `color-mix(in oklab, ${tone.stroke} 12%, transparent)` }}
        >
          {latest}
        </span>
      </Tooltip>
    );
  }

  const tooltipText = `${t.director.col_verdict_tooltip} — ${list.join(' → ')}`;
  return (
    <Tooltip content={tooltipText}>
      <span className="inline-flex items-center gap-1.5">
        <Sparkline scores={list} />
        <span
          className="text-[11px] tabular-nums"
          style={{ color: tone.stroke }}
        >
          {latest}
        </span>
      </span>
    </Tooltip>
  );
}
