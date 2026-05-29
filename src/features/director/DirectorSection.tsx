import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * The one panel surface every Director command-center module uses — a premium
 * gradient card with a micro-label header (uppercase, tracking-wider, the
 * control-surface cue) and an optional right-aligned action slot. Keeping a
 * single surface is what makes the five tabs read as one cohesive console
 * rather than five separately-built screens.
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
        <span className="inline-flex items-center gap-1.5 typo-label uppercase tracking-wider text-foreground/55">
          {Icon && <Icon className="w-3.5 h-3.5 text-violet-400/70" />}
          {label}
        </span>
        {action}
      </header>
      {children}
    </section>
  );
}
