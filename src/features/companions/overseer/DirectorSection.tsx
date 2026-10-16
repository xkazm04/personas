import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * The one panel surface the Director coaching tab uses — a gradient card with a
 * titled header and an optional right-aligned action slot. A single surface
 * keeps the scorecard and the coaching table reading as one cohesive console.
 *
 * The title wears `typo-title`, the kit's card-level heading (`Section`
 * level 2), so a Director card reads at the same size and tint as every other
 * card title in the app and follows the appearance type scale. The icon is
 * sized in `em` so it scales with that title rather than staying at a fixed
 * pixel size when the type scale moves.
 */
export function DirectorSection({
  label,
  icon: Icon,
  action,
  children,
  className,
  style,
}: {
  label: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      style={style}
      className={`relative overflow-hidden rounded-card border border-primary/10 bg-gradient-to-b from-secondary/35 to-secondary/10 shadow-elevation-1 p-4 ${className ?? ''}`}
    >
      <header className="flex items-center justify-between gap-3 mb-3">
        <h3 className="inline-flex items-center gap-2 typo-title min-w-0">
          {Icon && <Icon aria-hidden className="w-[1.1em] h-[1.1em] shrink-0 text-violet-300" />}
          <span className="truncate">{label}</span>
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}
