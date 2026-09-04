import { useMemo, type ReactNode } from 'react';
import { Moon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ConsolidationPoint } from '@/lib/bindings/ConsolidationPoint';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { ChartEmptyState } from '@/features/shared/components/display/ChartEmptyState';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { BrainChart, BrainChartTooltip, useChartChrome } from './BrainChartFrame';
import { useBrainPalette } from './brainPalette';
import { summarizeConsolidation } from './brainMath';

const TOOLTIP = <BrainChartTooltip />;
/** The denominator line — de-emphasis gray, same axis, same unit (counts). */
const FED_STROKE = 'var(--chart-axis-fill)';

/**
 * Consolidation yield — what each completed sleep pass actually produced.
 *
 * The four outcome series are stacked on ONE axis and the episodes fed run as
 * a line on that same axis: both are counts of the same kind of thing, so the
 * comparison is real (a second y-scale would invent one).
 */
export function ConsolidationYieldTile({ points }: { points: ConsolidationPoint[] }) {
  const { t } = useTranslation();
  const b = t.agents.brain;
  const palette = useBrainPalette();
  const chrome = useChartChrome();
  const s = useMemo(() => summarizeConsolidation(points), [points]);

  const rows = useMemo(
    () =>
      points.map((p) => ({
        at: p.completedAt.slice(5, 10),
        created: p.created,
        updated: p.updated,
        rejected: p.rejected,
        skipped: p.skippedTombstoned,
        fed: p.episodesFed,
      })),
    [points],
  );

  const series = [
    { key: 'created', label: b.yield_created },
    { key: 'updated', label: b.yield_updated },
    { key: 'rejected', label: b.yield_rejected },
    { key: 'skipped', label: b.yield_skipped },
  ] as const;

  return (
    <SectionCard
      title={b.yield_title}
      subtitle={b.yield_subtitle}
      icon={<Moon className="w-3.5 h-3.5 text-primary" aria-hidden />}
    >
      <div data-testid="brain-yield">
        {points.length === 0 ? (
          // Honest absence: no pass has completed, so there is no yield —
          // not a yield of zero.
          <ChartEmptyState
            variant="area"
            title={b.yield_empty_title}
            description={b.yield_empty_desc}
          />
        ) : (
          <>
            <BrainChart
              height={176}
              testId="brain-yield-chart"
              // The chart's identity: how many passes it drew and which one is
              // newest. A later pass gets a fresh error boundary rather than
              // the crash a malformed earlier pass latched.
              resetKey={`${rows.length}:${points[points.length - 1]?.completedAt ?? ''}`}
            >
              {(R) => (
                <R.ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <R.CartesianGrid stroke={chrome.gridStroke} vertical={false} />
                  <R.XAxis dataKey="at" tick={chrome.axisTick} minTickGap={12} />
                  <R.YAxis tick={chrome.axisTick} allowDecimals={false} width={40} />
                  <R.Tooltip content={TOOLTIP} cursor={{ fill: chrome.gridStroke }} />
                  {series.map((sd, i) => (
                    <R.Bar
                      key={sd.key}
                      dataKey={sd.key}
                      name={sd.label}
                      stackId="yield"
                      fill={palette.categorical[i]}
                      stroke="var(--background)"
                      strokeWidth={2}
                      radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined}
                      isAnimationActive={false}
                    />
                  ))}
                  <R.Line
                    type="monotone"
                    dataKey="fed"
                    name={b.yield_fed}
                    stroke={FED_STROKE}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </R.ComposedChart>
              )}
            </BrainChart>
            <YieldLegend series={series} colors={palette.categorical} fedLabel={b.yield_fed} />
            {/* Totals only exist once a pass has completed — with no pass,
                a row of zeros would read as a measured result. */}
            <YieldTotals summary={s} />
          </>
        )}
      </div>
    </SectionCard>
  );
}

function YieldLegend({
  series,
  colors,
  fedLabel,
}: {
  series: ReadonlyArray<{ key: string; label: string }>;
  colors: readonly string[];
  fedLabel: string;
}) {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((sd, i) => (
        <li key={sd.key} className="flex items-center gap-1.5 typo-caption text-foreground/85">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[i] }} aria-hidden />
          {sd.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5 typo-caption text-foreground/85">
        <span className="w-3 h-[2px] rounded-pill" style={{ backgroundColor: FED_STROKE }} aria-hidden />
        {fedLabel}
      </li>
    </ul>
  );
}

/**
 * The table twin of the chart: every plotted value is also readable here, so
 * no number is reachable only by hovering.
 */
function YieldTotals({ summary }: { summary: ReturnType<typeof summarizeConsolidation> }) {
  const { t } = useTranslation();
  const b = t.agents.brain;
  const cells: Array<{ label: string; node: ReactNode }> = [
    { label: b.yield_fed, node: <Numeric value={summary.episodesFed} unit="plain" /> },
    { label: b.yield_created, node: <Numeric value={summary.created} unit="plain" /> },
    { label: b.yield_updated, node: <Numeric value={summary.updated} unit="plain" /> },
    { label: b.yield_rejected, node: <Numeric value={summary.rejected} unit="plain" /> },
    { label: b.yield_skipped, node: <Numeric value={summary.skippedTombstoned} unit="plain" /> },
    { label: b.yield_diffs, node: <Numeric value={summary.selfModelDiffsProposed} unit="plain" /> },
    {
      label: b.yield_ratio,
      // `null` when nothing was ever fed — a 0% write rate would claim the
      // passes produced nothing, when in fact they were never given anything.
      node:
        summary.yieldRatio == null ? (
          <span className="text-foreground/85">{b.value_unmeasured}</span>
        ) : (
          <Numeric value={summary.yieldRatio * 100} unit="percent" precision={0} />
        ),
    },
    {
      label: b.yield_cost,
      // Absent, not zero: the subscription lane reports no cost at all.
      node:
        summary.costUsd == null ? (
          <span className="text-foreground/85">{b.yield_cost_unreported}</span>
        ) : (
          <Numeric value={summary.costUsd} unit="usd" />
        ),
    },
  ];
  return (
    <dl
      className="mt-3 pt-3 border-t border-primary/10 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2"
      data-testid="brain-yield-totals"
    >
      {cells.map((c) => (
        <div key={c.label}>
          <dt className="typo-overline text-foreground/85 truncate">{c.label}</dt>
          <dd className="typo-body text-foreground">{c.node}</dd>
        </div>
      ))}
    </dl>
  );
}
