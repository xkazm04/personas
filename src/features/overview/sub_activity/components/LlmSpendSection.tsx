import { memo, useMemo } from 'react';
import { Activity, AlertTriangle, Coins, DollarSign, Layers } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { KpiTile } from '@/features/overview/components/shared/KpiTile';
import { SUMMARY_GRID } from '@/features/overview/libs/dashboardGrid';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { CHART_COLORS, getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { fmtCost, fmtDate } from '../libs/executionMetricsHelpers';
import { ChartTooltipContent } from './MetricsCards';
import { useLlmSpend } from '../libs/useLlmSpend';
import type { LlmSpendGroup } from '@/lib/bindings/LlmSpendGroup';

// Stable tooltip element — Recharts compares by reference identity.
const TOOLTIP_CONTENT = <ChartTooltipContent />;
const COST_AXIS_FORMATTER = (v: number) => `$${v.toFixed(2)}`;

/** Humanize a technical trigger_kind / model id ("idea_scan" → "Idea scan"). */
function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Headless LLM spend lane in the Activity tab (tiger #1). Surfaces what the
 * background tiers cost — scanners, evaluators, design/recipe generators — that
 * don't appear in per-execution cost or Athena's own usage. Reads
 * `llm_spend_dashboard` via {@link useLlmSpend}.
 */
export const LlmSpendSection = memo(function LlmSpendSection() {
  const { t, language } = useTranslation();
  const { data, loading } = useLlmSpend();
  const sf = useScaledFontSize();
  const s = t.overview.llm_spend;

  const axisTick = useMemo(() => ({ fill: getAxisTickFill(), fontSize: sf(10) }), [sf]);
  const gridStroke = getGridStroke();

  const sourceLabel = (key: string): string => {
    const known = (s as Record<string, string>)[`source_${key}`];
    return known ?? humanize(key);
  };

  // SQL returns days newest-first; reverse for a left-to-right time axis.
  const dailyChart = useMemo(
    () => [...(data?.daily ?? [])].reverse().map((d) => ({ date: fmtDate(d.day), cost: d.cost_usd })),
    [data],
  );
  const bySource = useMemo(() => data?.by_source ?? [], [data]);
  const byTrigger = useMemo(() => (data?.by_trigger ?? []).slice(0, 8), [data]);

  // Sits below the Athena lane — a flash of empty chrome during the first fetch
  // is more jarring than its late arrival.
  if (loading && !data) return null;

  const totals = data?.totals;
  const hasActivity = (totals?.calls ?? 0) > 0;

  const renderBars = (rows: LlmSpendGroup[], label: (key: string) => string) => {
    const maxCost = rows[0]?.cost_usd || 1;
    return (
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={row.key} className="flex items-center gap-3 px-3 py-2 rounded-modal border border-primary/10 bg-secondary/20">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="typo-heading text-foreground truncate">{label(row.key)}</span>
                <span className="typo-code font-mono text-emerald-400">{fmtCost(row.cost_usd)}</span>
              </div>
              <div className="h-1.5 bg-secondary/40 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${(row.cost_usd / maxCost) * 100}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length], opacity: 0.7 }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <section className="space-y-3" data-testid="llm-spend-section">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-card bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <Layers className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <h3 className="typo-heading text-foreground/90">{s.section_title}</h3>
        <span className="typo-caption text-foreground">{s.section_hint}</span>
      </div>

      {!hasActivity ? (
        <div className="rounded-modal border border-primary/10 bg-secondary/20 px-4 py-6 text-center">
          <Layers className="w-5 h-5 text-foreground mx-auto mb-1.5" />
          <p className="typo-body text-foreground">{s.no_activity}</p>
        </div>
      ) : (
        <>
          <div className={SUMMARY_GRID}>
            <KpiTile icon={DollarSign} label={s.total_cost} color="emerald" numericValue={totals!.cost_usd} format={fmtCost} />
            <KpiTile icon={Activity} label={s.calls} color="blue" numericValue={totals!.calls} compact language={language} />
            <KpiTile icon={Coins} label={s.tokens} color="cyan" numericValue={totals!.input_tokens + totals!.output_tokens} compact language={language} />
            <KpiTile icon={AlertTriangle} label={s.errors} color="amber" numericValue={totals!.error_calls} compact language={language} />
          </div>

          {bySource.length > 0 && (
            <div className="space-y-2">
              <h4 className="typo-heading text-foreground">{s.by_source}</h4>
              {renderBars(bySource, sourceLabel)}
            </div>
          )}

          {byTrigger.length > 0 && (
            <div className="space-y-2">
              <h4 className="typo-heading text-foreground">{s.by_trigger}</h4>
              {renderBars(byTrigger, humanize)}
            </div>
          )}

          {dailyChart.length > 1 && (
            <div className="space-y-2">
              <h4 className="typo-heading text-foreground">{s.cost_per_day}</h4>
              <div className="h-40 2xl:h-48 bg-secondary/20 rounded-modal border border-primary/10 p-3">
                <ChartErrorBoundary>
                  <LazyChart render={(R) => (
                    <R.ResponsiveContainer width="100%" height="100%">
                      <R.AreaChart data={dailyChart}>
                        <R.CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <R.XAxis dataKey="date" tick={axisTick} />
                        <R.YAxis tick={axisTick} tickFormatter={COST_AXIS_FORMATTER} />
                        <R.Tooltip content={TOOLTIP_CONTENT} />
                        <R.Area type="monotone" dataKey="cost" stroke="#10b981" fill="#10b981" fillOpacity={0.25} strokeWidth={2} />
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
