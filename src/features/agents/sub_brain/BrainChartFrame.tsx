import { useMemo, type ReactElement } from 'react';
import { LazyChart, type RechartsModule } from '@/features/shared/charts/RechartsWrapper';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { getAxisTickFill, getGridStroke } from '@/features/overview/sub_usage/libs/chartConstants';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useScaledFontSize } from '@/stores/themeStore';

/**
 * The Brain dashboard's chart shell: lazy Recharts behind an error boundary,
 * sized so the container includes the x-axis band (a fixed height that crops
 * the axis is the classic nested-scroll defect).
 *
 * `ChartErrorBoundary` latches: once a malformed point throws, its own Retry
 * button re-runs the same render against the same data and the card stays
 * broken for every later dataset too — including a different persona's. The
 * boundary is therefore keyed on `resetKey`, which every caller MUST supply as
 * the identity of the data it draws, so new data gets a new boundary instead of
 * inheriting a stranger's crash.
 */
export function BrainChart({
  height,
  children,
  testId,
  resetKey,
}: {
  height: number;
  children: (R: RechartsModule) => ReactElement;
  testId?: string;
  resetKey: string;
}) {
  return (
    <div
      className="w-full [&_svg]:outline-none [&_.recharts-wrapper]:outline-none"
      style={{ height }}
      data-testid={testId}
    >
      <ChartErrorBoundary key={resetKey}>
        <LazyChart
          // A calm hold, never a spinner: the chunk arrives in a frame or two.
          fallback={<div className="h-full w-full rounded-input bg-secondary/20" aria-hidden />}
          render={(R) => (
            <R.ResponsiveContainer width="100%" height="100%">
              {children(R)}
            </R.ResponsiveContainer>
          )}
        />
      </ChartErrorBoundary>
    </div>
  );
}

/**
 * Axis / grid styling pulled from the theme's chart tokens, memoized per font
 * scale so Recharts' internal identity checks stay stable across renders.
 */
export function useChartChrome() {
  const sf = useScaledFontSize();
  return useMemo(
    () => ({
      axisTick: { fill: getAxisTickFill(), fontSize: sf(10) },
      legendStyle: { fontSize: sf(10) },
      gridStroke: getGridStroke(),
    }),
    [sf],
  );
}

interface TooltipPayloadEntry {
  name?: string;
  value?: number;
  color?: string;
}

/**
 * Hover readout for every Brain chart. Local rather than imported from the
 * Overview activity module so the agents chunk does not pull that surface in;
 * the tooltip is a hover ENHANCEMENT — every value it shows is also reachable
 * from the tile's own summary row.
 */
export function BrainChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const shown = payload.filter((e) => (e.value ?? 0) !== 0);
  return (
    <div className="bg-background/95 border border-primary/20 rounded-modal px-3 py-2 shadow-elevation-3 backdrop-blur-sm">
      {label && <p className="typo-caption text-foreground mb-1">{label}</p>}
      {(shown.length > 0 ? shown : payload).map((entry, i) => (
        <div key={`${entry.name ?? i}`} className="flex items-center gap-2 typo-caption">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
            aria-hidden
          />
          <span className="text-foreground/85">{entry.name}</span>
          <Numeric className="ml-auto text-foreground" value={entry.value ?? 0} unit="plain" />
        </div>
      ))}
    </div>
  );
}
