import { ResponsiveContainer } from 'recharts';
import type { ReactElement, ReactNode } from 'react';

interface MetricChartProps {
  title: string;
  /** Optional insight annotation shown below the title. */
  insight?: string | null;
  /** Height passed to ResponsiveContainer. */
  height: number;
  /** The Recharts chart element (BarChart, AreaChart, PieChart, …). */
  children: ReactElement;
  /** Additional className merged into the card wrapper (e.g. grid column span). */
  className?: string;
  /** Shown instead of the chart when provided and children is absent (empty state). */
  emptySlot?: ReactNode;
}

/**
 * Shared chart card: card shell + title/insight header + ResponsiveContainer.
 * Pass the Recharts chart element as children; axes and series remain caller-owned.
 */
export function MetricChart({
  title,
  insight,
  height,
  children,
  className,
  emptySlot,
}: MetricChartProps) {
  return (
    <div className={`bg-secondary/30 border border-primary/10 rounded-xl p-4 ${className ?? ''}`}>
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground/90">{title}</h3>
        {insight && <p className="text-sm text-muted-foreground/80 mt-1">{insight}</p>}
      </div>
      {emptySlot ?? (
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
