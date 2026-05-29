import { Bot, Gauge, Star, Coins, BarChart3, Cpu, MessageSquareText } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { StatCard } from '@/features/shared/components/display/StatCard';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { DirectorSection } from '../DirectorSection';
import { scoreTone, toneFill } from '../directorScore';
import type { UseDirector } from '../useDirector';

const SEVERITY_LINE: Record<string, string> = {
  error: 'var(--status-error)',
  warning: 'var(--status-warning)',
  info: 'var(--status-info)',
};
const SEVERITY_CHIP: Record<string, string> = {
  error: 'bg-red-500/15 text-red-400',
  warning: 'bg-amber-500/15 text-amber-400',
  info: 'bg-blue-500/15 text-blue-400',
};

/**
 * Command-center Overview: the portfolio scorecard. Surfaces the value rollup
 * that until now only ever reached the LLM — fleet value rate, average verdict,
 * cost-per-value, scope counts — plus a latest-score distribution, per-model
 * efficiency, and the recent coaching feed.
 */
export function DirectorOverview({ d }: { d: UseDirector }) {
  const { t, tx } = useTranslation();
  const p = d.portfolio;

  if (!p || p.inScope === 0) {
    return (
      <EmptyState
        icon={Bot}
        title={t.director.empty_title}
        subtitle={t.director.empty_subtitle}
        iconColor="text-violet-400/80"
        iconContainerClassName="bg-violet-500/10 border-violet-500/20"
        action={{ label: t.director.empty_cta, onClick: () => d.openDirector(), icon: Bot }}
      />
    );
  }

  const { rollup } = p;
  const avgTone = p.avgScore != null ? scoreTone(p.avgScore) : null;
  const maxBand = Math.max(1, ...p.scoreDistribution.map((b) => b.count));
  const maxModelRuns = Math.max(1, ...rollup.models.map((m) => m.executions));

  return (
    <div className="space-y-4 pb-6">
      {/* KPI row — staggered entry */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          style={{ animationDelay: '0ms' }}
          className="animate-fade-slide-in"
          label={t.director.kpi_value_rate}
          value={<Numeric value={rollup.valueDeliveredRate} unit="ratio" precision={0} />}
          icon={Gauge}
          tone={rollup.valueDeliveredRate >= 0.6 ? 'success' : rollup.valueDeliveredRate >= 0.3 ? 'warning' : 'danger'}
          hint={t.director.kpi_value_rate_hint}
        />
        <StatCard
          style={{ animationDelay: '40ms' }}
          className="animate-fade-slide-in"
          label={t.director.kpi_avg_score}
          value={p.avgScore != null ? <Numeric value={p.avgScore} precision={1} /> : '—'}
          icon={Star}
          tone={avgTone?.tier === 'high' ? 'success' : avgTone?.tier === 'mid' ? 'warning' : avgTone?.tier === 'low' ? 'danger' : 'neutral'}
          hint={t.director.kpi_avg_score_hint}
        />
        <StatCard
          style={{ animationDelay: '80ms' }}
          className="animate-fade-slide-in"
          label={t.director.kpi_cost_per_value}
          value={
            rollup.costPerValueDelivered != null ? (
              <Numeric value={rollup.costPerValueDelivered} unit="usd" />
            ) : (
              '—'
            )
          }
          icon={Coins}
          tone="info"
          hint={t.director.kpi_cost_per_value_hint}
        />
        <StatCard
          style={{ animationDelay: '120ms' }}
          className="animate-fade-slide-in"
          label={t.director.kpi_in_scope}
          value={<Numeric value={p.inScope} />}
          icon={Star}
          tone="neutral"
          hint={tx(t.director.kpi_in_scope_hint, { reviewed: p.reviewed, unreviewed: p.unreviewed })}
        />
      </div>

      {/* Score distribution */}
      <DirectorSection label={t.director.score_distribution} icon={BarChart3}>
        {p.reviewed === 0 ? (
          <p className="typo-caption text-foreground/45 py-2">{t.director.score_distribution_empty}</p>
        ) : (
          <div className="flex items-end gap-2.5 h-32 pt-3">
            {p.scoreDistribution.map((band, i) => {
              const tone = scoreTone(band.score);
              const hPct = (band.count / maxBand) * 100;
              return (
                <div key={band.score} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="typo-caption text-foreground/70 tabular-nums">{band.count}</span>
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className="w-full rounded-t-md animate-fade-slide-in"
                      style={{
                        height: `${Math.max(hPct, band.count > 0 ? 6 : 0)}%`,
                        minHeight: band.count > 0 ? 6 : 0,
                        background: band.count > 0
                          ? `linear-gradient(to top, ${tone.color}, color-mix(in oklab, ${tone.color} 55%, transparent))`
                          : 'transparent',
                        border: band.count === 0 ? '1px dashed var(--border)' : undefined,
                        animationDelay: `${i * 50}ms`,
                      }}
                    />
                  </div>
                  <span
                    className="typo-caption tabular-nums px-1.5 rounded font-medium"
                    style={{ color: tone.color, backgroundColor: toneFill(tone.color) }}
                  >
                    {band.score}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </DirectorSection>

      {/* Model efficiency */}
      {rollup.models.length > 0 && (
        <DirectorSection label={t.director.model_efficiency} icon={Cpu}>
          <div className="space-y-1.5">
            {rollup.models.map((m) => {
              const runPct = (m.executions / maxModelRuns) * 100;
              const valuePct = m.executions > 0 ? (m.valueDelivered / m.executions) * 100 : 0;
              return (
                <div key={m.model} className="grid grid-cols-[1.6fr_auto_auto_auto] items-center gap-3 px-1.5 py-1 rounded">
                  <div className="min-w-0">
                    <div className="typo-caption text-foreground/85 truncate" title={m.model}>{m.model}</div>
                    {/* runs bar with value-delivered overlay — motion as information */}
                    <div className="mt-1 h-1.5 rounded-pill bg-secondary/50 overflow-hidden" style={{ width: `${Math.max(runPct, 8)}%` }}>
                      <div className="h-full rounded-pill" style={{ width: `${valuePct}%`, background: 'var(--status-success)' }} />
                    </div>
                  </div>
                  <Numeric value={m.executions} className="typo-caption text-foreground/65 text-right tabular-nums" />
                  <Numeric value={m.costUsd} unit="usd" className="typo-caption text-foreground/65 text-right tabular-nums" />
                  <span className="typo-caption text-right tabular-nums" style={{ color: 'var(--status-success)' }}>
                    <Numeric value={m.valueDelivered} />
                  </span>
                </div>
              );
            })}
          </div>
        </DirectorSection>
      )}

      {/* Recent coaching */}
      <DirectorSection label={t.director.recent_verdicts} icon={MessageSquareText}>
        {d.verdicts.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-2">{t.director.no_verdicts}</p>
        ) : (
          <ul className="space-y-0.5">
            {d.verdicts.slice(0, 6).map((v) => (
              <li
                key={v.reviewId}
                className="row-hover-lift flex items-center gap-2 typo-caption pl-2.5 pr-1.5 py-1.5 rounded"
                style={{ ['--row-accent' as string]: SEVERITY_LINE[v.severity] ?? SEVERITY_LINE.info }}
              >
                <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${SEVERITY_CHIP[v.severity] ?? SEVERITY_CHIP.info}`}>
                  {tokenLabel(t, 'severity', v.severity)}
                </span>
                <span className="text-foreground/85 truncate flex-1" title={v.description ?? v.title}>{v.title}</span>
                <RelativeTime timestamp={v.createdAt} className="text-foreground/45 shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </DirectorSection>
    </div>
  );
}
