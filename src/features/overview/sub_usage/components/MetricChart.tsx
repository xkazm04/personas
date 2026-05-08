import type { ComponentType, ReactElement, ReactNode, SVGProps } from 'react';
import { ChartErrorBoundary } from './ChartErrorBoundary';
import { LazyChart, type RechartsModule } from '@/features/shared/charts/RechartsWrapper';

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
  insight?: string | null;
  height: number;
  /** Render the chart subtree. Receives the lazily-loaded recharts module. */
  chart: (R: RechartsModule) => ReactElement;
  className?: string;
  /** Shown instead of the chart when provided. */
  emptySlot?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
  iconColor?: MetricIconColor;
  loading?: boolean;
}

export function MetricChart({
  title, insight, height, chart, className, emptySlot, icon: Icon, iconColor = 'cyan', loading = false,
}: MetricChartProps) {
  return (
    <div className={`bg-secondary/20 border border-primary/10 rounded-modal p-4 ${className ?? ''}`}>
      <div className="mb-3">
        <h3 className="typo-heading uppercase tracking-widest text-foreground flex items-center gap-2">
          {Icon && (
            <div className={`p-1.5 rounded-card ${ICON_COLOR_CLASSES[iconColor]}`}>
              <Icon className="w-3.5 h-3.5" />
            </div>
          )}
          {title}
        </h3>
        {insight && <p className="typo-body text-foreground mt-1">{insight}</p>}
      </div>
      {loading ? (
        <div className="w-full rounded-card bg-secondary/60 overflow-hidden" style={{ height }}>
          <div className="h-full w-full" />
        </div>
      ) : (
        emptySlot ?? (
          <ChartErrorBoundary>
            <LazyChart
              fallback={<div className="w-full" style={{ height }} />}
              render={(R) => (
                <R.ResponsiveContainer width="100%" height={height}>
                  {chart(R)}
                </R.ResponsiveContainer>
              )}
            />
          </ChartErrorBoundary>
        )
      )}
    </div>
  );
}
