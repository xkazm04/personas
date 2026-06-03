import { useMemo, useState } from 'react';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
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
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Toggle a version's overlay; never hide the last visible series.
  const toggleVersion = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      if (radarVersions.length - next.size <= 1) return prev;
      next.add(id);
      return next;
    });
  };

  // Double-click a chip to isolate that version (or restore all if already soloed).
  const soloVersion = (id: string) => {
    setHidden((prev) => {
      const others = radarVersions.filter((v) => v.versionId !== id).map((v) => v.versionId);
      const alreadySolo = others.length > 0 && !prev.has(id) && others.every((o) => prev.has(o));
      return alreadySolo ? new Set<string>() : new Set(others);
    });
  };

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
            <LazyChart render={(R) => (
              <R.ResponsiveContainer width="100%" height="100%">
                <R.RadarChart data={radarData} outerRadius="72%">
                  <R.PolarGrid stroke={chart.gridStroke} />
                  <R.PolarAngleAxis dataKey="metric" tick={{ fill: chart.axisLabelFill, fontSize: sf(12) }} />
                  <R.PolarRadiusAxis domain={[0, 100]} tick={{ fill: chart.axisFill, fontSize: sf(10) }} />
                  <R.Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={((value: number | string | undefined) => [value ?? 0, 'Score']) as any}
                    contentStyle={{
                      background: chart.tooltipBg,
                      border: `1px solid ${chart.tooltipBorder}`,
                      borderRadius: 10,
                      color: chart.tooltipText,
                    }}
                  />
                  {radarVersions.map((agg, idx) => hidden.has(agg.versionId) ? null : (
                    <R.Radar key={agg.versionId} name={`v${agg.versionNumber}`} dataKey={agg.versionId}
                      stroke={seriesColor(idx, chart)}
                      fill={seriesColor(idx, chart)}
                      fillOpacity={0.16} strokeWidth={2} />
                  ))}
                </R.RadarChart>
              </R.ResponsiveContainer>
            )} />
          </ChartErrorBoundary>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {radarVersions.map((agg, idx) => {
            const isHidden = hidden.has(agg.versionId);
            return (
              <button
                key={agg.versionId}
                onClick={() => toggleVersion(agg.versionId)}
                onDoubleClick={() => soloVersion(agg.versionId)}
                aria-pressed={!isHidden}
                title={t.agents.lab.radar_solo_hint}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-card typo-body border border-primary/10 bg-secondary/20 text-foreground transition-opacity ${isHidden ? 'opacity-40' : 'hover:bg-secondary/40'}`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: seriesColor(idx, chart) }} />
                <span className={isHidden ? 'line-through' : ''}>v{agg.versionNumber}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
