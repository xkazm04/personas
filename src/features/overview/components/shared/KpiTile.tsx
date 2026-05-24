import { memo, useMemo, type ReactNode } from 'react';
import { TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { formatCompactNumber, formatCount } from '@/lib/utils/formatters';

/**
 * Unified KPI tile primitive — replaces 3 hand-rolled stat-tile shapes
 * (StatTile in DashboardHomeMissionControl, SummaryCard in sub_activity/
 * MetricsCards, OverviewStatCard in sub_observability) with one
 * density-discriminated component.
 *
 * Density modes:
 * - `console`: dense rounded-card row (font-mono caption + animated value).
 *   Color is passed as a Tailwind class (e.g. 'text-emerald-400') —
 *   suitable for tightly-themed dashboards that own their palette.
 * - `card`: standard rounded-modal tile with icon-left + label/value-right.
 *   Color is a SEMANTIC key from the unified palette — applied as a
 *   bg + border + text triple.
 * - `card-rich`: full-feature card with gradient background, optional
 *   sparkline, optional trend indicator, optional subtitle line. Color
 *   is the same semantic key as `card` density.
 *
 * Only one of `value` (string) or (`numericValue`+`format`) should be
 * supplied. When `numericValue` is set, the primitive uses
 * AnimatedCounter for a smooth previous→target transition.
 */

export type KpiDensity = 'console' | 'card' | 'card-rich';

/** Trend delta for `card-rich` density. */
export interface KpiTrend {
  /** Percent change. Negative = decrease. */
  pct: number;
  /** When true, treat negative changes as "good" (e.g. error rate going down is positive). */
  invertColor: boolean;
}

export interface KpiTileProps {
  /** Lucide icon component (preferred) or any ReactNode. */
  icon: LucideIcon | ReactNode;
  label: string;

  /** Static value when no animation is wanted. */
  value?: string;
  /** When set, the value animates from previous to current via AnimatedCounter. */
  numericValue?: number;
  /** Required when numericValue is set (ignored when `compact` is true). */
  format?: (n: number) => string;
  /**
   * Render `numericValue` with compact notation (`12.3K`, `4.5M`) so large
   * counts never overflow or wrap the tile, with the exact value surfaced as a
   * hover tooltip. Overrides `format`. Counts below 10k stay fully grouped.
   */
  compact?: boolean;
  /** BCP-47 locale for compact/grouped figures. Pass `language` from useTranslation(). */
  language?: string;

  /**
   * For `console` density: a Tailwind class (e.g. 'text-emerald-400').
   * For `card` / `card-rich`: a semantic palette key (see KPI_PALETTE).
   */
  color: string;
  density?: KpiDensity;

  /** Card-rich extras. Ignored on other densities. */
  trend?: KpiTrend | null;
  sparklineData?: number[];
  subtitle?: string | null;
  /** Override the subtitle's text color (semantic class allowed). */
  subtitleColor?: string;
}

/**
 * Unified semantic-key palette for `card` and `card-rich` densities.
 * Card density uses { bg, border, text }; card-rich density additionally
 * uses { gradient, iconBg } for its richer treatment.
 */
const KPI_PALETTE: Record<string, {
  text: string;
  bg: string;
  border: string;
  gradient: string;
  iconBg: string;
}> = {
  blue:    { text: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25',    gradient: 'from-blue-500/10 to-transparent border-blue-500/20',       iconBg: 'bg-blue-500/10 border-blue-500/20' },
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', gradient: 'from-emerald-500/10 to-transparent border-emerald-500/20', iconBg: 'bg-emerald-500/10 border-emerald-500/20' },
  green:   { text: 'text-green-400',   bg: 'bg-green-500/15',   border: 'border-green-500/25',   gradient: 'from-green-500/10 to-transparent border-green-500/20',     iconBg: 'bg-green-500/10 border-green-500/20' },
  violet:  { text: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/25',  gradient: 'from-violet-500/10 to-transparent border-violet-500/20',   iconBg: 'bg-violet-500/10 border-violet-500/20' },
  purple:  { text: 'text-purple-400',  bg: 'bg-purple-500/15',  border: 'border-purple-500/25',  gradient: 'from-purple-500/10 to-transparent border-purple-500/20',   iconBg: 'bg-purple-500/10 border-purple-500/20' },
  red:     { text: 'text-red-400',     bg: 'bg-red-500/15',     border: 'border-red-500/25',     gradient: 'from-red-500/10 to-transparent border-red-500/20',         iconBg: 'bg-red-500/10 border-red-500/20' },
  amber:   { text: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25',   gradient: 'from-amber-500/10 to-transparent border-amber-500/20',     iconBg: 'bg-amber-500/10 border-amber-500/20' },
  cyan:    { text: 'text-cyan-400',    bg: 'bg-cyan-500/15',    border: 'border-cyan-500/25',    gradient: 'from-cyan-500/10 to-transparent border-cyan-500/20',       iconBg: 'bg-cyan-500/10 border-cyan-500/20' },
  primary: { text: 'text-primary',     bg: 'bg-primary/15',     border: 'border-primary/25',     gradient: 'from-primary/10 to-transparent border-primary/20',         iconBg: 'bg-primary/10 border-primary/20' },
};

const SPARKLINE_HEX: Record<string, string> = {
  blue: '#3b82f6', emerald: '#10b981', green: '#22c55e', violet: '#8b5cf6',
  purple: '#a855f7', red: '#ef4444', amber: '#f59e0b', cyan: '#06b6d4', primary: '#8b5cf6',
};

function Sparkline({ data, hex }: { data: number[]; hex: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 32, h = 16;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="mt-1" aria-hidden="true">
      <polyline points={points} fill="none" stroke={hex} strokeOpacity={0.45} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function renderIcon(icon: KpiTileProps['icon'], className?: string): ReactNode {
  if (typeof icon === 'function') {
    const I = icon as LucideIcon;
    return <I className={className ?? 'w-4 h-4'} />;
  }
  return icon;
}

function renderValue(
  value: string | undefined,
  numericValue: number | undefined,
  format: ((n: number) => string) | undefined,
  density: KpiDensity,
  compact: boolean,
  language: string | undefined,
) {
  if (numericValue !== undefined) {
    // Headline card densities get the slot-machine roll for emotional weight;
    // the dense `console` density keeps the cheaper fade so list rows don't
    // each fire a 280ms animation when refreshes batch.
    const mode = density === 'console' ? 'fade' : 'roll';
    if (compact) {
      const full = formatCount(numericValue, { language, precision: 0 });
      const display = formatCompactNumber(numericValue, { language });
      // Only attach the tooltip when compaction actually hid digits, so small
      // counts don't get a redundant "1,234 → 1,234" hover.
      const title = display !== full ? full : undefined;
      return (
        <AnimatedCounter
          value={numericValue}
          formatFn={(v) => formatCompactNumber(v, { language })}
          mode={mode}
          title={title}
        />
      );
    }
    return <AnimatedCounter value={numericValue} formatFn={format} mode={mode} />;
  }
  // Static value: route through <Numeric> so the figure style is explicit and
  // consistent with the animated path (tabular lining figures).
  return <Numeric>{value ?? ''}</Numeric>;
}

export const KpiTile = memo(function KpiTile({
  icon, label, value, numericValue, format, compact = false, language, color,
  density = 'card', trend, sparklineData, subtitle, subtitleColor,
}: KpiTileProps) {
  const trendDisplay = useMemo(() => {
    if (!trend || trend.pct === 0) return null;
    const isUp = trend.pct > 0;
    const isGood = trend.invertColor ? !isUp : isUp;
    const TIcon = isUp ? TrendingUp : TrendingDown;
    const trendColor = isGood ? 'text-emerald-400' : 'text-red-400';
    const absPct = Math.abs(trend.pct);
    const text = absPct >= 1000 ? '999+%' : absPct < 0.1 ? '<0.1%' : `${absPct.toFixed(1)}%`;
    return { TIcon, trendColor, text };
  }, [trend]);

  if (density === 'console') {
    return (
      <div className="rounded-card border border-primary/10 bg-primary/[0.03] px-3 py-2.5 flex items-center gap-2.5">
        <span className={color}>{renderIcon(icon)}</span>
        <div className="flex-1 min-w-0">
          <div className="typo-caption uppercase tracking-widest text-foreground font-mono">{label}</div>
          <div className={`font-mono text-xl tabular-nums ${color}`}>
            {renderValue(value, numericValue, format, density, compact, language)}
          </div>
        </div>
      </div>
    );
  }

  const palette = KPI_PALETTE[color] ?? KPI_PALETTE.blue!;

  if (density === 'card') {
    return (
      <div className={`flex items-center gap-3 px-4 py-3 rounded-modal border ${palette.border} ${palette.bg}`}>
        {renderIcon(icon, `w-4 h-4 ${palette.text}`)}
        <div className="min-w-0">
          <p className="typo-body text-foreground truncate">{label}</p>
          <p className={`typo-heading ${palette.text}`}>
            {renderValue(value, numericValue, format, density, compact, language)}
          </p>
        </div>
      </div>
    );
  }

  // density === 'card-rich'
  return (
    <div className={`relative rounded-modal border bg-gradient-to-br ${palette.gradient} bg-secondary/20 p-4 shadow-elevation-1 overflow-hidden`}>
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-card border shadow-inner flex items-center justify-center ${palette.iconBg} ${palette.text}`}>
              {renderIcon(icon, 'w-4 h-4')}
            </div>
            <span className="typo-heading text-foreground truncate">{label}</span>
          </div>
          {sparklineData && sparklineData.length >= 2 && (
            <Sparkline data={sparklineData} hex={SPARKLINE_HEX[color] ?? '#3b82f6'} />
          )}
        </div>
        <div className="mt-auto">
          <div className="typo-data-lg tracking-tight text-foreground/90">
            {renderValue(value, numericValue, format, density, compact, language)}
          </div>
          <div className="flex items-center gap-2.5 mt-1.5 min-h-[18px]">
            {trendDisplay ? (
              <div className={`flex items-center gap-1 typo-heading ${trendDisplay.trendColor}`}>
                <trendDisplay.TIcon className="w-3 h-3" />
                <span>{trendDisplay.text}</span>
              </div>
            ) : <span className="typo-body text-foreground">--</span>}
            {subtitle && (
              <p className={`typo-body truncate ${subtitleColor || 'text-foreground'}`}>{subtitle}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
