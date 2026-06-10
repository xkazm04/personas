import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { scoreTone, toneFill } from '../directorScore';
import type { DirectorScoreBand } from '@/api/director';

/**
 * Score-distribution histogram — one bar per 0–5 band, tinted by its score
 * tone. Each band carries a tooltip with its exact count, and a dashed marker
 * line + label pins where the portfolio average falls across the bands, so the
 * distribution reads against its own mean at a glance.
 */
export function ScoreDistribution({
  bands,
  avgScore,
}: {
  bands: DirectorScoreBand[];
  avgScore: number | null;
}) {
  const { t, tx } = useTranslation();
  const total = bands.reduce((s, b) => s + b.count, 0);

  if (total === 0) {
    return <p className="typo-caption text-foreground py-2">{t.director.score_distribution_empty}</p>;
  }

  const maxBand = Math.max(1, ...bands.map((b) => b.count));

  // Average marker: map avgScore from the band value range onto the bars'
  // [0, n-1] index axis, then to a center-of-band fraction. Gaps between bars
  // introduce a sub-pixel drift that's invisible for an indicator line.
  let avgLeftPct: number | null = null;
  if (avgScore != null && bands.length > 0) {
    const n = bands.length;
    const minS = bands[0]!.score;
    const maxS = bands[n - 1]!.score;
    const span = maxS - minS || 1;
    const idx = Math.max(0, Math.min(n - 1, ((avgScore - minS) / span) * (n - 1)));
    avgLeftPct = ((idx + 0.5) / n) * 100;
  }

  return (
    <div className="relative flex items-end gap-2.5 h-28 pt-2">
      {bands.map((band, i) => {
        const tone = scoreTone(band.score);
        const hPct = (band.count / maxBand) * 100;
        return (
          <Tooltip key={band.score} content={tx(t.director.distribution_band, { score: band.score, count: band.count })}>
            <div className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end cursor-default">
              <span className="typo-caption text-foreground tabular-nums">{band.count}</span>
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full rounded-t-input animate-fade-slide-in"
                  style={{
                    height: `${Math.max(hPct, band.count > 0 ? 6 : 0)}%`,
                    minHeight: band.count > 0 ? 6 : 0,
                    background: band.count > 0 ? `linear-gradient(to top, ${tone.color}, color-mix(in oklab, ${tone.color} 55%, transparent))` : 'transparent',
                    border: band.count === 0 ? '1px dashed var(--border)' : undefined,
                    animationDelay: `${i * 50}ms`,
                  }}
                />
              </div>
              <span className="typo-caption tabular-nums px-1.5 rounded font-medium" style={{ color: tone.color, backgroundColor: toneFill(tone.color) }}>
                {band.score}
              </span>
            </div>
          </Tooltip>
        );
      })}

      {/* Portfolio-average marker */}
      {avgLeftPct != null && avgScore != null && (
        <div aria-hidden className="absolute inset-y-0 pointer-events-none" style={{ left: `${avgLeftPct}%` }}>
          <div className="absolute inset-y-0 left-0 w-px border-l border-dashed" style={{ borderColor: 'var(--muted-foreground)' }} />
          <span
            className="absolute -top-1 left-0 -translate-x-1/2 inline-flex items-center gap-0.5 px-1 rounded bg-background/90 typo-caption text-foreground whitespace-nowrap"
          >
            {t.director.avg_label}
            <Numeric value={avgScore} precision={1} className="tabular-nums font-medium" />
          </span>
        </div>
      )}
    </div>
  );
}
