import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { ScoreSparkline } from '@/features/overview/sub_director/ScoreSparkline';
import { scoreTone, toneFill } from '@/features/overview/sub_director/directorScore';

/**
 * Compact 0-5 Director-score trend for a persona row. Renders nothing when
 * there are no scores yet, a single coloured chip when there is one score,
 * and an SVG sparkline + latest-score chip when there are two or more.
 *
 * Score tones + sparkline geometry come from the shared `directorScore` /
 * `ScoreSparkline` helpers so this cell and the command center stay in lockstep.
 */
export function VerdictTrendCell({ scores }: { scores: number[] | undefined }) {
  const { t } = useTranslation();
  const list = scores ?? [];

  if (list.length === 0) {
    return <span className="typo-caption text-foreground">—</span>;
  }

  const latest = list[list.length - 1]!;
  const tone = scoreTone(latest);

  if (list.length === 1) {
    return (
      <Tooltip content={t.director.col_verdict_tooltip}>
        <span
          className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded text-[11px] tabular-nums"
          style={{ color: tone.color, backgroundColor: toneFill(tone.color) }}
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
        <ScoreSparkline scores={list} />
        <span className="text-[11px] tabular-nums" style={{ color: tone.color }}>
          {latest}
        </span>
      </span>
    </Tooltip>
  );
}
