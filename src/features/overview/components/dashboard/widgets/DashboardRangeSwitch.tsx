import { memo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';

/**
 * Compact 7d / 30d / 90d segmented control for the Home Traffic chart. Drives
 * the store's `executionDashboardDays` via `fetchExecutionDashboard`, so both
 * the fleet traffic series and the persona-scoped bundle re-query on change.
 * Labels are non-localized day shorthands (mirrors DayRangePicker); the group
 * reuses the existing time-range aria label.
 */

const RANGE_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

export const DashboardRangeSwitch = memo(function DashboardRangeSwitch() {
  const { t } = useTranslation();
  const { days, loading, fetchExecutionDashboard } = useOverviewStore(useShallow((s) => ({
    days: s.executionDashboardDays,
    loading: s.executionDashboardLoading,
    fetchExecutionDashboard: s.fetchExecutionDashboard,
  })));
  const active = days ?? 30;

  const onPick = useCallback((d: number) => {
    if (d !== active) void fetchExecutionDashboard(d);
  }, [active, fetchExecutionDashboard]);

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
