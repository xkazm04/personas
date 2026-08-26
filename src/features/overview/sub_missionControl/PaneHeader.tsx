import type { ReactNode } from 'react';

/**
 * Shared header bar for Mission Control panes and dashboard cards: a
 * mono-caption label, optional subtitle, and a trailing slot (e.g. a
 * `FleetTag` chip, an `ArrowRight` affordance, or nothing). Centralizes the
 * header chrome so panes/cards don't hand-roll the same
 * `flex items-center justify-between px-3 py-2 border-b ...` block.
 */
export function PaneHeader({
  label, subtitle, children,
}: { label: string; subtitle?: string; children?: ReactNode }) {
  return (
    // One row, always: the label never wraps, the subtitle truncates before it
    // would, and the trailing slot keeps its intrinsic width (shrink-0).
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="typo-caption font-mono uppercase tracking-[0.3em] text-foreground whitespace-nowrap">{label}</span>
        {subtitle && (
          <span className="typo-caption text-foreground truncate">{subtitle}</span>
        )}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  );
}
