import { memo, useMemo } from 'react';
import { Bot, Zap, DollarSign, Coins, Gauge } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { KpiTile } from '@/features/overview/components/shared/KpiTile';
import { SUMMARY_GRID } from '@/features/overview/libs/dashboardGrid';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { CHART_COLORS, getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { fmtCost, fmtDate } from '../libs/executionMetricsHelpers';
import { ChartTooltipContent } from './MetricsCards';
import { useAthenaUsage } from '../libs/useAthenaUsage';

// Stable tooltip element — Recharts compares by reference identity.
const TOOLTIP_CONTENT = <ChartTooltipContent />;
const COST_AXIS_FORMATTER = (v: number) => `$${v.toFixed(2)}`;

/**
 * Athena's own usage lane in the Activity tab (direction 6 / A3). Surfaces what
 * Athena costs — turns, spend, tokens — next to the fleet figures she triages,
 * broken down by action type (chat vs proactive vs headless triage). Reads
 * `companion_get_usage_dashboard` via {@link useAthenaUsage}.
 */
interface AthenaUsageSectionProps {
  /** Fleet total cost for the same window — the headline comparison. */
  fleetCost: number;
}

/** Friendly label for a (origin, triggerKind) action bucket. */
function useActionLabel() {
  const { t } = useTranslation();
  const a = t.overview.athena;
  return (origin: string, triggerKind: string | null): string => {
    if (triggerKind) {
      const known = (a as Record<string, string>)[`leg_${triggerKind}`];
      if (known) return known;
      // Proactive trigger kinds without a dedicated label (incident_blocker,
      // dev_goal_target, …) — humanize the technical identifier.
      return triggerKind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    }
    switch (origin) {
      case 'chat': return a.origin_chat;
      case 'autonomous': return a.origin_autonomous;
      case 'proactive': return a.origin_proactive;
      case 'external': return a.origin_external;
      case 'headless': return a.origin_headless;
      default: return origin;
    }
  };
}

export const AthenaUsageSection = memo(function AthenaUsageSection({ fleetCost }: AthenaUsageSectionProps) {
  const { t, tx, language } = useTranslation();
  const { data, loading } = useAthenaUsage();
  const sf = useScaledFontSize();
  const actionLabel = useActionLabel();
  const a = t.overview.athena;

  const axisTick = useMemo(() => ({ fill: getAxisTickFill(), fontSize: sf(10) }), [sf]);
  const gridStroke = getGridStroke();

  const dailyChart = useMemo(
    () => (data?.daily ?? []).map((d) => ({ date: fmtDate(d.date), cost: d.costUsd })),
    [data],
  );
  const topActions = useMemo(
    () => (data?.byOrigin ?? []).slice(0, 8),
    [data],
  );

  // Don't render the lane at all while the first fetch is in flight — it sits
  // below the fleet cards, so a flash of empty chrome would be more jarring
  // than its late arrival.
  if (loading && !data) return null;

  const totals = data?.totals;
  const hasActivity = (totals?.turns ?? 0) > 0;

  return (
    <section className="space-y-3" data-testid="athena-usage-section">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-card bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
        <h3 className="typo-heading text-foreground/90">{a.section_title}</h3>
        <span className="typo-caption text-foreground">{a.section_hint}</span>
      </div>

      {!hasActivity ? (
        <div className="rounded-modal border border-primary/10 bg-secondary/20 px-4 py-6 text-center">
          <Bot className="w-5 h-5 text-foreground mx-auto mb-1.5" />
          <p className="typo-body text-foreground">{a.no_activity}</p>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className={SUMMARY_GRID}>
            <KpiTile icon={Zap} label={a.turns} color="blue" numericValue={totals!.turns} compact language={language} />
            <KpiTile icon={DollarSign} label={a.total_cost} color="violet" numericValue={totals!.costUsd} format={fmtCost} />
            <KpiTile icon={Gauge} label={a.avg_cost} color="amber" numericValue={totals!.avgCostPerTurn} format={fmtCost} />
            <KpiTile
              icon={Coins}
              label={a.tokens}
              color="cyan"
              numericValue={totals!.inputTokens + totals!.outputTokens}
              compact
              language={language}
              density="card-rich"
              subtitle={tx(a.tokens_io, {
                input: Math.round(totals!.inputTokens).toLocaleString(language),
                output: Math.round(totals!.outputTokens).toLocaleString(language),
              })}
            />
          </div>

          {/* Athena vs fleet headline */}
          <div className="rounded-modal border border-primary/10 bg-secondary/20 px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="typo-body text-foreground">{a.vs_fleet}</span>
              <span className="typo-body text-foreground">
                {tx(a.vs_fleet_hint, { athena: fmtCost(totals!.costUsd), total: fmtCost(fleetCost) })}
              </span>
            </div>
            <div className="h-2 bg-secondary/40 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-500/70 transition-all"
                style={{ width: `${Math.min(100, fleetCost > 0 ? (totals!.costUsd / fleetCost) * 100 : 0)}%` }}
              />
            </div>
          </div>

          {/* Cost by action type */}
          {topActions.length > 0 && (
            <div className="space-y-2">
              <h4 className="typo-heading text-foreground">{a.cost_by_action}</h4>
              <div className="space-y-1.5">
                {topActions.map((row, i) => {
                  const maxCost = topActions[0]?.costUsd || 1;
                  const pct = (row.costUsd / maxCost) * 100;
                  return (
                    <div key={`${row.origin}:${row.triggerKind ?? ''}`} className="flex items-center gap-3 px-3 py-2 rounded-modal border border-primary/10 bg-secondary/20">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="typo-heading text-foreground truncate">{actionLabel(row.origin, row.triggerKind)}</span>
                          <span className="typo-code font-mono text-violet-400">{fmtCost(row.costUsd)}</span>
                        </div>
                        <div className="h-1.5 bg-secondary/40 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length], opacity: 0.7 }} />
                        </div>
                        <div className="mt-1 typo-body text-foreground">
                          {tx(t.overview.activity.executions_label, { count: Math.round(row.turns) })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cost per day */}
          {dailyChart.length > 1 && (
            <div className="space-y-2">
              <h4 className="typo-heading text-foreground">{a.cost_per_day}</h4>
              <div className="h-40 2xl:h-48 bg-secondary/20 rounded-modal border border-primary/10 p-3">
                <ChartErrorBoundary>
                  <LazyChart render={(R) => (
                    <R.ResponsiveContainer width="100%" height="100%">
                      <R.AreaChart data={dailyChart}>
                        <R.CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <R.XAxis dataKey="date" tick={axisTick} />
                        <R.YAxis tick={axisTick} tickFormatter={COST_AXIS_FORMATTER} />
                        <R.Tooltip content={TOOLTIP_CONTENT} />
                        <R.Area type="monotone" dataKey="cost" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} strokeWidth={2} />
                      </R.AreaChart>
                    </R.ResponsiveContainer>
                  )} />
                </ChartErrorBoundary>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
});
