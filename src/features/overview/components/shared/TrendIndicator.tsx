import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { TrendValue } from '@/features/overview/utils/computeTrends';
import { useOverviewTranslation } from '@/features/overview/i18n/useOverviewTranslation';

interface TrendIndicatorProps {
  trend: TrendValue;
  /** When true, a decrease is the "good" direction (e.g. cost, latency) */
  invertPolarity?: boolean;
}

export function TrendIndicator({ trend, invertPolarity }: TrendIndicatorProps) {
  const { t } = useOverviewTranslation();

  if (trend.direction === 'stable') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/70"
        title={t.trend.stable}
      >
        <Minus className="w-3 h-3" />
      </span>
    );
  }

  const isGood = invertPolarity
    ? trend.direction === 'down'
    : trend.direction === 'up';

  const color = isGood ? 'text-emerald-400' : 'text-red-400';
  const Icon = trend.direction === 'up' ? TrendingUp : TrendingDown;
  const label = trend.direction === 'up' ? t.trend.up : t.trend.down;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${color}`}
      title={`${label} ${trend.pctChange.toFixed(1)}% ${t.trend.vs_previous}`}
    >
      <Icon className="w-3 h-3" />
      {trend.pctChange.toFixed(0)}%
    </span>
  );
}
