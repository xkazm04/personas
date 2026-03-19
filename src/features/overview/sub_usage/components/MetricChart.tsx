import { ResponsiveContainer } from 'recharts';
import type { ComponentType, ReactElement, ReactNode, SVGProps } from 'react';
import { ChartErrorBoundary } from './ChartErrorBoundary';

export type MetricIconColor =
  | 'cyan' | 'violet' | 'indigo' | 'amber' | 'emerald' | 'blue'
  | 'rose' | 'purple' | 'sky' | 'teal' | 'orange' | 'pink';

const ICON_COLOR_CLASSES: Record<MetricIconColor, string> = {
  cyan:    'bg-cyan-500/10 text-cyan-400',
  violet:  'bg-violet-500/10 text-violet-400',
  indigo:  'bg-indigo-500/10 text-indigo-400',
  amber:   'bg-amber-500/10 text-amber-400',
  emerald: 'bg-emerald-500/10 text-emerald-400',
  blue:    'bg-blue-500/10 text-blue-400',
  rose:    'bg-rose-500/10 text-rose-400',
  purple:  'bg-purple-500/10 text-purple-400',
  sky:     'bg-sky-500/10 text-sky-400',
  teal:    'bg-teal-500/10 text-teal-400',
  orange:  'bg-orange-500/10 text-orange-400',
  pink:    'bg-pink-500/10 text-pink-400',
};

interface MetricChartProps {
  title: string;
  /** Optional insight annotation shown below the title. */
  insight?: string | null;
  /** Height passed to ResponsiveContainer. */
  height: number;
  /** The Recharts chart element (BarChart, AreaChart, PieChart, ...). */
  children: ReactElement;
  /** Additional className merged into the card wrapper (e.g. grid column span). */
  className?: string;
  /** Shown instead of the chart when provided and children is absent (empty state). */
  emptySlot?: ReactNode;
  /** Optional Lucide icon rendered as a 24x24 rounded badge left of the title. */
  icon?: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
  /** Colour token applied to the icon badge background/text (e.g. "cyan", "violet"). */
  iconColor?: MetricIconColor;
  /** When true, renders an empty placeholder in place of the chart. */
  loading?: boolean;
}

/**
 * Shared chart card: card shell + title/insight header + ResponsiveContainer.
 * Pass the Recharts chart element as children; axes and series remain caller-owned.
 */
export function MetricChart({
  title, insight, height, children, className, emptySlot, icon: Icon, iconColor = 'cyan', loading = false,
}: MetricChartProps) {
  return (
    <div className={`bg-secondary/30 border border-primary/10 rounded-xl p-4 ${className ?? ''}`}>
      <div className="mb-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-foreground/80 flex items-center gap-2">
          {Icon && (
            <div className={`p-1.5 rounded-lg ${ICON_COLOR_CLASSES[iconColor]}`}>
              <Icon className="w-3.5 h-3.5" />
            </div>
          )}
          {title}
        </h3>
        {insight && <p className="text-sm text-muted-foreground/80 mt-1">{insight}</p>}
      </div>
      {loading ? (
        <div className="w-full rounded-lg bg-secondary/60 overflow-hidden" style={{ height }}>
          <div className="h-full w-full" />
        </div>
      ) : (
        emptySlot ?? (
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height={height}>
              {children}
            </ResponsiveContainer>
          </ChartErrorBoundary>
        )
      )}
    </div>
  );
}
