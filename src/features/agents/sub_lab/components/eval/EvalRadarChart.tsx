import { useMemo } from 'react';
import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ResponsiveContainer, Tooltip,
} from 'recharts';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { useScaledFontSize } from '@/stores/themeStore';
import type { VersionAggregate } from '../../libs/evalAggregation';
import { useTranslation } from '@/i18n/useTranslation';
import { useChartTheme, seriesColor } from '../../shared/chartTheme';

interface EvalRadarChartProps {
  versionAggs: VersionAggregate[];
}

export function EvalRadarChart({ versionAggs }: EvalRadarChartProps) {
  const { t } = useTranslation();
  const sf = useScaledFontSize();
  const chart = useChartTheme();
  const radarVersions = versionAggs.slice(0, 4);

  const radarData = useMemo(() =>
    [
      { metric: 'Tool Accuracy', key: 'avgToolAccuracy' },
      { metric: 'Output Quality', key: 'avgOutputQuality' },
      { metric: 'Protocol Compliance', key: 'avgProtocolCompliance' },
    ].map((row) => {
      const values: Record<string, number | string> = { metric: row.metric };
      for (const agg of radarVersions) {
        values[agg.versionId] = (agg[row.key as keyof VersionAggregate] as number) ?? 0;
      }
      return values;
    }),
    [radarVersions],
  );

  if (radarVersions.length < 2) return null;

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2.5 typo-heading font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary/40 to-accent/40 rounded-full" />
        {t.agents.lab.radar_title}
      </h4>
      <div className="border border-primary/10 rounded-modal bg-background/20 p-3">
        <div className="h-[260px]" data-testid="eval-radar-chart">
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke={chart.gridStroke} />
                <PolarAngleAxis dataKey="metric" tick={{ fill: chart.axisLabelFill, fontSize: sf(12) }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fill: chart.axisFill, fontSize: sf(10) }} />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={((value: number | string | undefined) => [value ?? 0, 'Score']) as any}
                  contentStyle={{
                    background: chart.tooltipBg,
                    border: `1px solid ${chart.tooltipBorder}`,
                    borderRadius: 10,
                    color: chart.tooltipText,
                  }}
                />
                {radarVersions.map((agg, idx) => (
                  <Radar key={agg.versionId} name={`v${agg.versionNumber}`} dataKey={agg.versionId}
                    stroke={seriesColor(idx, chart)}
                    fill={seriesColor(idx, chart)}
                    fillOpacity={0.16} strokeWidth={2} />
                ))}
              </RadarChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {radarVersions.map((agg, idx) => (
            <span key={agg.versionId} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-card typo-body border border-primary/10 bg-secondary/20 text-foreground">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: seriesColor(idx, chart) }} />
              v{agg.versionNumber}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
