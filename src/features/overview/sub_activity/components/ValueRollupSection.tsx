import { useEffect, useState } from 'react';
import { Target, DollarSign, CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { KpiTile } from '@/features/overview/components/shared/KpiTile';
import { BusinessOutcomeBadge } from '@/features/shared/components/display/BusinessOutcomeBadge';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { getValueRollup } from '@/api/overview/observability';
import { fmtCost } from '../libs/executionMetricsHelpers';
import { silentCatch } from '@/lib/silentCatch';
import { SUMMARY_GRID } from '@/features/overview/libs/dashboardGrid';
import type { ValueRollup } from '@/lib/bindings/ValueRollup';

interface Props {
  /** Window (days) — kept in sync with the dashboard's range picker. */
  days: number;
}

/** Outcome buckets in the order shown in the distribution row. */
const OUTCOME_ORDER: Array<{ key: string; count: (r: ValueRollup) => number }> = [
  { key: 'value_delivered', count: (r) => r.valueDelivered },
  { key: 'partial', count: (r) => r.partial },
  { key: 'precondition_failed', count: (r) => r.preconditionFailed },
  { key: 'no_input_available', count: (r) => r.noInputAvailable },
  { key: 'unknown', count: (r) => r.unknown },
];

/**
 * Business-value rollup section for the activity dashboard. Surfaces the
 * value-delivered rate, cost-per-value-delivered, and the outcome distribution
 * derived from each run's `business_outcome` self-assessment — the honest
 * "did this earn its cost" view that raw execution counts can't show.
 */
export function ValueRollupSection({ days }: Props) {
  const { t, language } = useTranslation();
  const [rollup, setRollup] = useState<ValueRollup | null>(null);

  useEffect(() => {
    let active = true;
    getValueRollup(days)
      .then((r) => {
        if (active) setRollup(r);
      })
      .catch(silentCatch);
    return () => {
      active = false;
    };
  }, [days]);

  // Nothing assessable yet — don't render a misleading 0% headline.
  if (!rollup || rollup.assessedExecutions === 0) return null;

  const ratePct = rollup.valueDeliveredRate * 100;

  return (
    <div className="space-y-2">
      <h4 className="typo-heading text-emerald-400/80 flex items-center gap-1.5">
        <Target className="w-3 h-3" /> {t.overview.activity.value_section_title}
      </h4>
      <div className={SUMMARY_GRID}>
        <KpiTile
          icon={Target}
          label={t.overview.activity.value_delivered_rate}
          color="emerald"
          numericValue={ratePct}
          format={(v) => `${v.toFixed(0)}%`}
        />
        <KpiTile
          icon={DollarSign}
          label={t.overview.activity.cost_per_value}
          color="violet"
          value={rollup.costPerValueDelivered != null ? fmtCost(rollup.costPerValueDelivered) : '—'}
        />
        <KpiTile
          icon={CheckCircle2}
          label={t.overview.activity.value_delivered_count}
          color="green"
          numericValue={rollup.valueDelivered}
          compact
          language={language}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 pt-1">
        {OUTCOME_ORDER.filter((o) => o.count(rollup) > 0).map((o) => (
          <span key={o.key} className="inline-flex items-center gap-1.5 typo-body text-foreground/80">
            <BusinessOutcomeBadge outcome={o.key} variant="compact" />
            <Numeric>{o.count(rollup)}</Numeric>
          </span>
        ))}
      </div>
    </div>
  );
}
