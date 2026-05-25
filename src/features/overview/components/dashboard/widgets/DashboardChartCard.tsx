import { memo, type ReactElement, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LazyChart, type RechartsModule } from '@/features/shared/charts/RechartsWrapper';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { EmptyState, type EmptyStateVariant } from '@/features/shared/components/display/EmptyState';
import { CARD_CONTAINER } from '@/features/overview/libs/dashboardGrid';

/**
 * DashboardChartCard — the shared shell for every chart on the Mission Control
 * Home page. Owns the card container, the title/icon header with a right-aligned
 * `actions` slot (legend totals, range switch, …), the lazy-loaded Recharts
 * boundary, and the empty state. Individual charts supply only their title,
 * decoration, and the chart subtree.
 *
 * Stage 1 migrates the Traffic & Errors chart; later stages fold the heatmap,
 * sparkline, and rotation panels onto the same primitive so the Home charts
 * finally share one visual language.
 */

interface DashboardChartCardProps {
  /** Header title (already translated). */
  title: string;
  /** Optional leading icon rendered in a tinted chip. */
  icon?: LucideIcon;
  /** Tailwind classes for the icon chip (bg + text), e.g. 'bg-cyan-500/10 text-cyan-400'. */
  iconChipClass?: string;
  /** Decorative blur color class for the top-right glow, e.g. 'bg-cyan-500/5'. */
  accentClass?: string;
  /** Right-aligned header content: legend totals, a range switch, etc. */
  actions?: ReactNode;
  /** Footer row below the chart (axis captions, range bounds). */
  footer?: ReactNode;
  /** Height utility class for the chart body. Defaults to `h-32`. */
  bodyHeightClass?: string;
  /** When true, the empty state replaces the chart. */
  isEmpty?: boolean;
  emptyVariant?: EmptyStateVariant;
  /** Accessible label for the whole card. */
  ariaLabel?: string;
  /** Render the chart subtree with the lazily-loaded Recharts module. */
  children: (R: RechartsModule) => ReactElement;
}

export const DashboardChartCard = memo(function DashboardChartCard({
  title, icon: Icon, iconChipClass = 'bg-cyan-500/10 text-cyan-400',
  accentClass = 'bg-cyan-500/5', actions, footer, bodyHeightClass = 'h-32',
  isEmpty = false, emptyVariant = 'chart', ariaLabel, children,
}: DashboardChartCardProps) {
  return (
    <div
      className={`${CARD_CONTAINER} p-4 space-y-4 relative overflow-hidden [&_svg]:outline-none [&_.recharts-wrapper]:outline-none`}
      aria-label={ariaLabel}
    >
      <div className={`absolute top-0 right-0 w-32 h-32 ${accentClass} blur-3xl rounded-full pointer-events-none`} />

      <div className="flex items-center justify-between gap-2 relative z-10">
        <h3 className="typo-label text-foreground flex items-center gap-2 min-w-0">
          {Icon && (
            <div className={`p-1.5 rounded-card ${iconChipClass}`}>
              <Icon className="w-3.5 h-3.5" />
            </div>
          )}
          <span className="truncate">{title}</span>
        </h3>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>

      <div className={`${bodyHeightClass} w-full relative z-10`}>
        {isEmpty ? (
          <EmptyState variant={emptyVariant} dominant className="py-6" />
        ) : (
          <ChartErrorBoundary>
            <LazyChart render={(R) => (
              <R.ResponsiveContainer width="100%" height="100%">
                {children(R)}
              </R.ResponsiveContainer>
            )} />
          </ChartErrorBoundary>
        )}
      </div>

      {footer && <div className="pt-3 border-t border-primary/5 relative z-10">{footer}</div>}
    </div>
  );
});
