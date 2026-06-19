import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { TrendValue } from '@/features/overview/libs/computeTrends';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';

interface TrendIndicatorProps {
  trend: TrendValue;
  /** When true, a decrease is the "good" direction (e.g. cost, latency) */
  invertPolarity?: boolean;
}

export function TrendIndicator({ trend, invertPolarity }: TrendIndicatorProps) {
  const { t } = useTranslation();

  if (trend.direction === 'stable') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] text-foreground"
        title={t.overview.trend.stable}
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
  const label = trend.direction === 'up' ? t.overview.trend.up : t.overview.trend.down;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${color}`}
      title={`${label} ${trend.pctChange.toFixed(1)}% ${t.overview.trend.vs_previous}`}
    >
      <Icon className="w-3 h-3" />
      <Numeric value={trend.pctChange} unit="percent" precision={0} />
    </span>
  );
}
