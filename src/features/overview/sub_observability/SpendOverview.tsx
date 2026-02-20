import { useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';

export interface TrendData {
  /** Percentage change (positive = increase, negative = decrease) */
  pct: number;
  /** If true, a decrease is good (green) and increase is bad (red) -- e.g. cost */
  invertColor: boolean;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 32;
  const h = 16;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="mt-1" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeOpacity={0.4} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SPARKLINE_HEX: Record<string, string> = {
  emerald: '#10b981',
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#a855f7',
};

export interface SummaryCardProps {
  icon: LucideIcon;
  label: string;
  numericValue: number;
  format: (n: number) => string;
  color: string;
  trend?: TrendData | null;
  sparklineData?: number[];
}

export function SummaryCard({ icon: Icon, label, numericValue, format, color, trend, sparklineData }: SummaryCardProps) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
  };
  const cls = colorMap[color] || colorMap.blue;
  const animated = useAnimatedNumber(numericValue);

  const trendDisplay = useMemo(() => {
    if (!trend || (trend.pct === 0)) return null;
    const isUp = trend.pct > 0;
    const isGood = trend.invertColor ? !isUp : isUp;
    const TIcon = isUp ? TrendingUp : TrendingDown;
    const trendColor = isGood ? 'text-emerald-400' : 'text-red-400';
    const absPct = Math.abs(trend.pct);
    const label = absPct >= 1000 ? '999+%' : absPct < 0.1 ? '<0.1%' : `${absPct.toFixed(1)}%`;
    return { TIcon, trendColor, label };
  }, [trend]);

  return (
    <div className="bg-secondary/30 border border-primary/15 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${cls}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-xs text-muted-foreground/60">{label}</span>
      </div>
      <div className="text-xl font-bold text-foreground">{format(animated)}</div>
      {sparklineData && sparklineData.length >= 2 && (
        <Sparkline data={sparklineData} color={SPARKLINE_HEX[color] || '#3b82f6'} />
      )}
      {trendDisplay && (
        <div className={`flex items-center gap-1 mt-1.5 text-[11px] ${trendDisplay.trendColor}`}>
          <trendDisplay.TIcon className="w-3 h-3" />
          <span>{trendDisplay.label}</span>
          <span className="text-muted-foreground/30 ml-0.5">vs prev</span>
        </div>
      )}
    </div>
  );
}
