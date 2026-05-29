import { Bot, Gauge, Star, Coins } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { StatCard } from '@/features/shared/components/display/StatCard';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { scoreTone, toneFill } from '../directorScore';
import type { UseDirector } from '../useDirector';

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

  return (
    <div className="space-y-4 pb-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={t.director.kpi_value_rate}
          value={<Numeric value={rollup.valueDeliveredRate} unit="ratio" precision={0} />}
          icon={Gauge}
          tone={rollup.valueDeliveredRate >= 0.6 ? 'success' : rollup.valueDeliveredRate >= 0.3 ? 'warning' : 'danger'}
          hint={t.director.kpi_value_rate_hint}
        />
        <StatCard
          label={t.director.kpi_avg_score}
          value={p.avgScore != null ? <Numeric value={p.avgScore} precision={1} /> : '—'}
          icon={Star}
          tone={avgTone?.tier === 'high' ? 'success' : avgTone?.tier === 'mid' ? 'warning' : avgTone?.tier === 'low' ? 'danger' : 'neutral'}
          hint={t.director.kpi_avg_score_hint}
        />
        <StatCard
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
          label={t.director.kpi_in_scope}
          value={<Numeric value={p.inScope} />}
          icon={Star}
          tone="neutral"
          hint={tx(t.director.kpi_in_scope_hint, { reviewed: p.reviewed, unreviewed: p.unreviewed })}
        />
      </div>

      {/* Score distribution */}
      <SectionCard title={t.director.score_distribution} size="sm">
        {p.reviewed === 0 ? (
          <p className="typo-caption text-foreground/45 py-2">{t.director.score_distribution_empty}</p>
        ) : (
          <div className="flex items-end gap-2 h-28 pt-2">
            {p.scoreDistribution.map((band) => {
              const tone = scoreTone(band.score);
              const h = `${(band.count / maxBand) * 100}%`;
              return (
                <div key={band.score} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="typo-caption text-foreground/60 tabular-nums">{band.count}</span>
                  <div
                    className="w-full rounded-t transition-[height]"
                    style={{ height: h, minHeight: band.count > 0 ? 4 : 0, backgroundColor: band.count > 0 ? tone.color : 'transparent', border: band.count === 0 ? '1px dashed var(--border)' : undefined }}
                  />
                  <span
                    className="typo-caption tabular-nums px-1.5 rounded"
                    style={{ color: tone.color, backgroundColor: toneFill(tone.color) }}
                  >
                    {band.score}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Model efficiency */}
      {rollup.models.length > 0 && (
        <SectionCard title={t.director.model_efficiency} size="sm">
          <table className="w-full text-left">
            <thead>
              <tr className="typo-caption text-foreground/50 border-b border-primary/10">
                <th className="py-1.5 font-normal">{t.director.model_col_model}</th>
                <th className="py-1.5 font-normal text-right">{t.director.model_col_runs}</th>
                <th className="py-1.5 font-normal text-right">{t.director.model_col_cost}</th>
                <th className="py-1.5 font-normal text-right">{t.director.model_col_value}</th>
              </tr>
            </thead>
            <tbody>
              {rollup.models.map((m) => (
                <tr key={m.model} className="border-b border-primary/5 last:border-0">
                  <td className="py-1.5 typo-caption text-foreground/85 truncate max-w-[200px]" title={m.model}>{m.model}</td>
                  <td className="py-1.5 text-right"><Numeric value={m.executions} className="typo-caption text-foreground/70" /></td>
                  <td className="py-1.5 text-right"><Numeric value={m.costUsd} unit="usd" className="typo-caption text-foreground/70" /></td>
                  <td className="py-1.5 text-right"><Numeric value={m.valueDelivered} className="typo-caption text-foreground/70" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}

      {/* Recent coaching */}
      <SectionCard title={t.director.recent_verdicts} size="sm">
        {d.verdicts.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-2">{t.director.no_verdicts}</p>
        ) : (
          <ul className="space-y-1">
            {d.verdicts.slice(0, 6).map((v) => (
              <li key={v.reviewId} className="flex items-center gap-2 typo-caption px-1.5 py-1 rounded hover:bg-secondary/30">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${
                    v.severity === 'error' ? 'bg-red-500/15 text-red-400'
                      : v.severity === 'warning' ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-blue-500/15 text-blue-400'
                  }`}
                >
                  {tokenLabel(t, 'severity', v.severity)}
                </span>
                <span className="text-foreground/85 truncate flex-1" title={v.description ?? v.title}>{v.title}</span>
                <RelativeTime timestamp={v.createdAt} className="text-foreground/45 shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
