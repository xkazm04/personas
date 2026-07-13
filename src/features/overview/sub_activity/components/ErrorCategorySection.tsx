import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { KpiTile } from '@/features/overview/components/shared/KpiTile';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { getErrorCategoryBreakdown } from '@/api/overview/observability';
import { silentCatch } from '@/lib/silentCatch';
import { SUMMARY_GRID } from '@/features/overview/libs/dashboardGrid';
import type { ErrorCategoryBreakdown } from '@/lib/bindings/ErrorCategoryBreakdown';

interface Props {
  /** Window (days) — kept in sync with the dashboard's range picker. */
  days: number;
}

/**
 * Category-grounded delta indicator for a single error category. A rise in
 * failures is bad (red ↑); a fall is good (emerald ↓). Renders nothing when the
 * category is flat against the prior window.
 */
function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  const color = up ? 'text-red-400' : 'text-emerald-400';
  return (
    <span className={`inline-flex items-center gap-0.5 typo-caption ${color}`}>
      <Icon className="w-3 h-3" />
      <Numeric>{Math.abs(delta)}</Numeric>
    </span>
  );
}

/**
 * Category-aware error analytics for the activity dashboard. Surfaces where
 * failures actually cluster — per the 11-category error taxonomy classified at
 * aggregation time in Rust — with a delta against the prior window of equal
 * length, plus each agent's dominant failure category. Renders nothing when the
 * window had no failures, so a healthy period shows a clean dashboard.
 */
export function ErrorCategorySection({ days }: Props) {
  const { t, language } = useTranslation();
  const [data, setData] = useState<ErrorCategoryBreakdown | null>(null);

  useEffect(() => {
    let active = true;
    getErrorCategoryBreakdown(days)
      .then((d) => {
        if (active) setData(d);
      })
      .catch(silentCatch('ErrorCategorySection:getErrorCategoryBreakdown'));
    return () => {
      active = false;
    };
  }, [days]);

  // No failures in the window — a category breakdown of zero is noise, not signal.
  if (!data || data.totalFailures === 0) return null;

  const prior = data.priorTotalFailures;
  const deltaPct = prior > 0 ? ((data.totalFailures - prior) / prior) * 100 : 0;

  return (
    <div className="space-y-2">
      <h4 className="typo-heading text-red-400/80 flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3" /> {t.overview.activity.error_category_section_title}
      </h4>
      <div className={SUMMARY_GRID}>
        <KpiTile
          icon={AlertTriangle}
          label={t.overview.activity.error_category_total_failures}
          color="red"
          density="card-rich"
          numericValue={data.totalFailures}
          compact
          language={language}
          trend={prior > 0 ? { pct: deltaPct, invertColor: true } : null}
          subtitle={t.overview.activity.error_category_prior_period}
        />
      </div>

      {/* Per-category counts + category-grounded deltas */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 pt-1">
        {data.categories.map((c) => (
          <span
            key={c.category}
            className="inline-flex items-center gap-1.5 typo-body text-foreground"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-400/60" aria-hidden="true" />
            {tokenLabel(t, 'error_category', c.category)}
            <Numeric>{c.count}</Numeric>
            <DeltaBadge delta={c.delta} />
          </span>
        ))}
      </div>

      {/* Per-agent dominant failure category */}
      {data.personaTopCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <span className="typo-caption uppercase tracking-wider text-foreground">
            {t.overview.activity.error_category_by_persona}
          </span>
          {data.personaTopCategories.map((p) => (
            <span
              key={p.personaId}
              className="inline-flex items-center gap-1 typo-caption text-foreground"
            >
              <span className="text-primary">{p.personaName}</span>
              {tokenLabel(t, 'error_category', p.category)}
              <Numeric>{p.count}</Numeric>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
