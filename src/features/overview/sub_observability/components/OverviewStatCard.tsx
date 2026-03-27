import { memo, useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAnimatedNumber } from '@/hooks/utility/timing/useAnimatedNumber';

export interface TrendData {
  pct: number;
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
      <polyline points={points} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SPARKLINE_HEX: Record<string, string> = {
  emerald: '#10b981',
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#a855f7',
  red: '#ef4444',
  amber: '#f59e0b',
  primary: '#8b5cf6',
};

export interface OverviewStatCardProps {
  icon: LucideIcon;
  label: string;
  numericValue: number;
  format: (n: number) => string;
  color: string;
  trend?: TrendData | null;
  sparklineData?: number[];
  subtitle?: string | null;
  subtitleColor?: string;
}

export const OverviewStatCard = memo(function OverviewStatCard({
  icon: Icon,
  label,
  numericValue,
  format,
  color,
  trend,
  sparklineData,
  subtitle,
  subtitleColor,
}: OverviewStatCardProps) {
  const colorMap: Record<string, string> = {
    emerald: 'from-emerald-500/10 to-transparent border-emerald-500/20 text-emerald-400',
    blue: 'from-blue-500/10 to-transparent border-blue-500/20 text-blue-400',
    green: 'from-green-500/10 to-transparent border-green-500/20 text-green-400',
    purple: 'from-purple-500/10 to-transparent border-purple-500/20 text-purple-400',
    red: 'from-red-500/10 to-transparent border-red-500/20 text-red-400',
    amber: 'from-amber-500/10 to-transparent border-amber-500/20 text-amber-400',
    primary: 'from-primary/10 to-transparent border-primary/20 text-primary',
  };

  const iconBgMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    primary: 'bg-primary/10 border-primary/20 text-primary',
  };

  const bgGrad = colorMap[color] || colorMap.blue;
  const iconCls = iconBgMap[color] || iconBgMap.blue;
  const animated = useAnimatedNumber(numericValue);

  const trendDisplay = useMemo(() => {
    if (!trend || trend.pct === 0) return null;
    const isUp = trend.pct > 0;
    const isGood = trend.invertColor ? !isUp : isUp;
    const TIcon = isUp ? TrendingUp : TrendingDown;
    const trendColor = isGood ? 'text-emerald-400' : 'text-red-400';
    const absPct = Math.abs(trend.pct);
    const value = absPct >= 1000 ? '999+%' : absPct < 0.1 ? '<0.1%' : `${absPct.toFixed(1)}%`;
    return { TIcon, trendColor, value };
  }, [trend]);

  return (
    <div className={`relative rounded-xl border bg-gradient-to-br ${bgGrad} bg-secondary/20 p-4 shadow-elevation-1 overflow-hidden`}>
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-lg border shadow-inner flex items-center justify-center ${iconCls}`}>
              <Icon className="w-4 h-4" />
            </div>
            <span className="typo-heading text-foreground/75 truncate">{label}</span>
          </div>
          {sparklineData && sparklineData.length >= 2 && (
            <Sparkline data={sparklineData} color={SPARKLINE_HEX[color] || '#3b82f6'} />
          )}
        </div>

        <div className="mt-auto">
          <div className="typo-data-lg tracking-tight text-foreground/90">{format(animated)}</div>
          <div className="flex items-center gap-2.5 mt-1.5 min-h-[18px]">
            {trendDisplay ? (
              <div className={`flex items-center gap-1 typo-heading ${trendDisplay.trendColor}`}>
                <trendDisplay.TIcon className="w-3 h-3" />
                <span>{trendDisplay.value}</span>
              </div>
            ) : <span className="text-sm text-muted-foreground/50">--</span>}

            {subtitle && (
              <p className={`text-sm truncate ${subtitleColor || 'text-muted-foreground/70'}`}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
