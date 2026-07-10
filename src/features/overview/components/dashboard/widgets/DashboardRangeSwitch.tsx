import { memo, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import {
  useOverviewFilterValues,
  useOverviewFilterActions,
  type OverviewDayRange,
} from '@/features/overview/components/dashboard/OverviewFilterContext';

/**
 * Compact 7d / 30d / 90d segmented control for the Home Traffic chart.
 *
 * Range is UNIFIED with the rest of Overview: this writes the shared
 * `OverviewFilterContext.dayRange` (the same state the Execution Metrics
 * DayRangePicker drives), so the single `useExecutionDashboardPipeline` fetch
 * re-queries once — no separate `fetchExecutionDashboard` call, and no
 * double-fetch racing the pipeline. Labels are non-localized day shorthands
 * (mirrors DayRangePicker); the group reuses the existing time-range aria label.
 */

const RANGE_OPTIONS: { value: OverviewDayRange; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

export const DashboardRangeSwitch = memo(function DashboardRangeSwitch() {
  const { t } = useTranslation();
  const { dayRange } = useOverviewFilterValues();
  const { setDayRange } = useOverviewFilterActions();
  const loading = useOverviewStore((s) => s.executionDashboardLoading);
  const active = dayRange;

  const onPick = useCallback((d: OverviewDayRange) => {
    if (d !== active) setDayRange(d);
  }, [active, setDayRange]);

  return (
    <div
      role="group"
      aria-label={t.overview.usage_filters.time_range_label}
      className="flex items-center gap-0.5 rounded-interactive border border-primary/10 bg-primary/[0.03] p-0.5"
    >
      {RANGE_OPTIONS.map((opt) => {
        const isActive = active === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPick(opt.value)}
            disabled={loading}
            aria-pressed={isActive}
            className={`typo-caption font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-interactive transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 ${
              isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-primary/[0.06]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
});
