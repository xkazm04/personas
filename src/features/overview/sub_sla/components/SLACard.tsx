import { formatPercent } from '../libs/slaHelpers';
import { rateToHealth, HEALTH_STATUS_TOKEN } from '@/lib/design/statusTokens';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

/** Plot height of the daily-trend strip, in px. The row takes its height from this
 *  constant AND every bar is sized in absolute pixels against it, so the two can
 *  never drift apart. */
const TREND_PLOT_H = 96;
/** Floor so a zero-rate day still reads as a mark rather than as missing data. */
const TREND_BAR_MIN_H = 2;

/**
 * Bar height in ABSOLUTE PIXELS for a 0–1 success rate.
 *
 * Deliberately not a percentage, and the reason is this chart's own history —
 * it has rendered at 0px twice:
 *
 *  1. `afcb2fb4b2` replaced an animating `motion.div` (`animate={{ height: h }}`,
 *     where `h` was a px number) with a plain div and dropped the `height` with
 *     it. `h` went unused, then got renamed `_h` and finally deleted to silence
 *     the lint — erasing the evidence that a height was ever meant to be there.
 *  2. `0d0ce97d44` re-added a height to un-blank the chart, but as a PERCENTAGE.
 *     A percentage height resolves against the containing block's height, and
 *     each bar's parent column is an auto-height flex item in an `items-end`
 *     row — indefinite. So the percentage resolved to auto, the column itself
 *     measured 0px, and all 30 bars painted at 0px again. Measured in headless
 *     Chromium: `colHeight: 0`, 30/30 bars at 0px.
 *
 * Pixels remove the whole failure mode: there is no containing block to consult,
 * and the value is assertable in a jsdom test (`__tests__/SLACard.test.tsx`),
 * which a resolved layout is not.
 */
function trendBarHeight(successRate: number): number {
  const rate = Math.min(1, Math.max(0, successRate));
  return Math.max(TREND_BAR_MIN_H, rate * TREND_PLOT_H);
}

export function DailyTrendChart({ points }: { points: { date: string; success_rate: number; total: number }[] }) {
  const { t, tx } = useTranslation();
  if (points.length === 0) return null;
  const barWidth = Math.max(4, Math.min(16, Math.floor(600 / points.length)));

  return (
    <div className="flex items-end gap-px overflow-x-auto overflow-y-hidden" style={{ height: TREND_PLOT_H }}>
      {points.map((p, i) => {
        // A day with no runs has no success rate. Both callers send 0 for it,
        // which painted an idle day as a full-red 0% failure; it gets the
        // neutral floor mark instead, never a rate colour.
        const noData = p.total <= 0;
        const color = noData
          ? HEALTH_STATUS_TOKEN.neutral.icon
          : `${HEALTH_STATUS_TOKEN[rateToHealth(p.success_rate)].icon}/60`;
        return (
          <Tooltip
            key={i}
            content={tx(p.total === 1 ? t.overview.sla_card.daily_trend_hint_one : t.overview.sla_card.daily_trend_hint_other, {
              date: p.date,
              rate: noData ? '—' : formatPercent(p.success_rate),
              count: p.total,
            })}
          >
            <div className="flex flex-col items-center justify-end flex-shrink-0" style={{ width: barWidth }}>
              <div
                data-testid="sla-trend-bar"
                data-no-data={noData ? 'true' : undefined}
                className={`animate-fade-in w-full rounded-t-interactive ${color}`}
                style={{ height: noData ? TREND_BAR_MIN_H : trendBarHeight(p.success_rate) }}
              />
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}
