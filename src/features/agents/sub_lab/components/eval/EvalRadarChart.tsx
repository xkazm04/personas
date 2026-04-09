import { useEffect, useMemo, useState } from 'react';
import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ResponsiveContainer, Tooltip,
} from 'recharts';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import {
  getAxisTickFill, getGridStroke, getThemeChartPalette, getTooltipStyle,
} from '@/features/overview/sub_usage/charts/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { useLabTranslation } from '../../i18n/useLabTranslation';
import type { VersionAggregate } from '../../libs/evalAggregation';

interface EvalRadarChartProps {
  versionAggs: VersionAggregate[];
}

/** Read theme CSS vars into chart styling primitives. */
function useThemeChartStyles() {
  const [styles, setStyles] = useState(() => ({
    palette: getThemeChartPalette(),
    gridStroke: getGridStroke(),
    axisFill: getAxisTickFill(),
    tooltip: getTooltipStyle(),
  }));

  useEffect(() => {
    // Re-read after mount (and on theme changes via MutationObserver)
    const refresh = () =>
      setStyles({
        palette: getThemeChartPalette(),
        gridStroke: getGridStroke(),
        axisFill: getAxisTickFill(),
        tooltip: getTooltipStyle(),
      });

    refresh();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme' || m.attributeName === 'style') {
          refresh();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return styles;
}

export function EvalRadarChart({ versionAggs }: EvalRadarChartProps) {
  const sf = useScaledFontSize();
  const { t } = useLabTranslation();
  const { palette, gridStroke, axisFill, tooltip } = useThemeChartStyles();
  const radarVersions = versionAggs.slice(0, 4);

  const radarData = useMemo(() =>
    [
      { metric: t.radar.toolAccuracy, key: 'avgToolAccuracy' },
      { metric: t.radar.outputQuality, key: 'avgOutputQuality' },
      { metric: t.radar.protocolCompliance, key: 'avgProtocolCompliance' },
    ].map((row) => {
      const values: Record<string, number | string> = { metric: row.metric };
      for (const agg of radarVersions) {
        values[agg.versionId] = (agg[row.key as keyof VersionAggregate] as number) ?? 0;
      }
      return values;
    }),
    [radarVersions, t],
  );

  if (radarVersions.length < 2) return null;

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary/40 to-accent/40 rounded-full" />
        {t.radar.title}
      </h4>
      <div className="border border-primary/10 rounded-xl bg-background/20 p-3">
        <div className="h-[260px]" data-testid="eval-radar-chart">
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke={gridStroke} />
                <PolarAngleAxis dataKey="metric" tick={{ fill: axisFill, fontSize: sf(12) }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fill: axisFill, fontSize: sf(10) }} />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={((value: number | string | undefined) => [value ?? 0, t.radar.score]) as any}
                  contentStyle={tooltip}
                />
                {radarVersions.map((agg, idx) => (
                  <Radar key={agg.versionId} name={`v${agg.versionNumber}`} dataKey={agg.versionId}
                    stroke={palette[idx % palette.length]}
                    fill={palette[idx % palette.length]}
                    fillOpacity={0.16} strokeWidth={2} />
                ))}
              </RadarChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {radarVersions.map((agg, idx) => (
            <span key={agg.versionId} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm border border-primary/10 bg-secondary/20 text-foreground/80">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: palette[idx % palette.length] }} />
              v{agg.versionNumber}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
