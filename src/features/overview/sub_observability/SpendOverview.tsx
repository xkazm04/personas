import { useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAnimatedNumber } from '@/hooks/utility/useAnimatedNumber';

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
  subtitle?: string | null;
  subtitleColor?: string;
}

export function SummaryCard({ icon: Icon, label, numericValue, format, color, trend, sparklineData, subtitle, subtitleColor }: SummaryCardProps) {
  const colorMap: Record<string, string> = {
    emerald: 'from-emerald-500/5 to-transparent border-emerald-500/20 text-emerald-400',
    blue: 'from-blue-500/5 to-transparent border-blue-500/20 text-blue-400',
    green: 'from-green-500/5 to-transparent border-green-500/20 text-green-400',
    purple: 'from-purple-500/5 to-transparent border-purple-500/20 text-purple-400',
  };
  
  const iconBgMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
  };

  const bgGrad = colorMap[color] || colorMap.blue;
  const iconCls = iconBgMap[color] || iconBgMap.blue;
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
    <div className={`relative bg-gradient-to-br ${bgGrad} bg-secondary/20 border border-primary/10 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 overflow-hidden group`}>
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl border shadow-inner flex items-center justify-center ${iconCls}`}>
              <Icon className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-widest">{label}</span>
          </div>
          {sparklineData && sparklineData.length >= 2 && (
            <div className="opacity-60 group-hover:opacity-100 transition-opacity">
              <Sparkline data={sparklineData} color={SPARKLINE_HEX[color] || '#3b82f6'} />
            </div>
          )}
        </div>
        
        <div className="mt-auto">
          <div className="text-3xl font-black tracking-tight text-foreground/90">{format(animated)}</div>
          
          <div className="flex items-center gap-3 mt-2 min-h-[20px]">
            {trendDisplay ? (
              <div className={`flex items-center gap-1 text-xs font-bold ${trendDisplay.trendColor} bg-background/50 px-1.5 py-0.5 rounded border border-primary/5`}>
                <trendDisplay.TIcon className="w-3.5 h-3.5" />
                <span>{trendDisplay.label}</span>
              </div>
            ) : <span className="text-xs text-muted-foreground/50">—</span>}
            
            {subtitle && (
              <p className={`text-xs font-medium truncate ${subtitleColor || 'text-muted-foreground/70'}`}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
