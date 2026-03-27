import { useMemo } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/** Badge visual style */
export type BadgeVariant = 'count' | 'pulse' | 'dot';

export interface BadgeDefinition {
  /** Unique key for this badge */
  id: string;
  /** Lower number = higher priority (shown first) */
  priority: number;
  /** Whether this badge is currently active */
  active: boolean;
  /** Human-readable label for the tooltip */
  label: string;
  /** Visual variant */
  variant: BadgeVariant;
  /** Tailwind color classes for the badge (bg, border, shadow) */
  color: string;
  /** Ping/pulse ring color (for 'pulse' variant) */
  pingColor?: string;
  /** Count to display (for 'count' variant) */
  count?: number;
  /** Click handler (e.g. dismiss) */
  onClick?: (e: React.MouseEvent) => void;
}

interface BadgeSlotProps {
  badges: BadgeDefinition[];
}

/**
 * BadgeSlot — renders a single priority-ranked badge indicator in the
 * top-right corner of a sidebar button.  When multiple badges are active,
 * only the highest-priority one is shown with a "+N" overflow counter.
 * A tooltip on hover lists every active state.
 */
export function BadgeSlot({ badges }: BadgeSlotProps) {
  const activeBadges = useMemo(
    () => badges
      .filter((b) => b.active)
      .sort((a, b) => a.priority - b.priority),
    [badges],
  );

  const top = activeBadges[0] as BadgeDefinition | undefined;
  if (!top) return null;

  const suppressed = activeBadges.length - 1;
  const tooltipText = activeBadges.map((b) => b.label).join(' · ');

  const handleClick = top.onClick
    ? (e: React.MouseEvent) => { e.stopPropagation(); top.onClick!(e); }
    : undefined;

  return (
    <Tooltip content={tooltipText} placement="right" delay={300}>
      <span
        className={`absolute top-0.5 right-0.5 z-20 min-w-[16px] h-4 flex items-center justify-center ${top.onClick ? 'cursor-pointer' : ''}`}
        onClick={handleClick}
      >
        {top.variant === 'count' && (
          <span className={`min-w-[16px] h-4 px-1 flex items-center justify-center typo-heading leading-none rounded-full text-white shadow-elevation-1 ${top.color}`}>
            {(top.count ?? 0) > 99 ? '99+' : top.count}
            {suppressed > 0 && (
              <span className="ml-0.5 text-[8px] opacity-80">+{suppressed}</span>
            )}
          </span>
        )}

        {top.variant === 'pulse' && (
          <>
            <span className={`absolute inset-0 rounded-full animate-ping ${top.pingColor ?? 'bg-orange-500/40'}`} />
            <span className={`relative w-2.5 h-2.5 rounded-full border ${top.color}`} />
            {suppressed > 0 && (
              <span className="absolute -bottom-1.5 -right-1 min-w-[12px] h-3 px-0.5 flex items-center justify-center typo-heading text-[8px] leading-none rounded-full bg-foreground/80 text-background shadow-elevation-1">
                +{suppressed}
              </span>
            )}
          </>
        )}

        {top.variant === 'dot' && (
          <>
            <span className={`w-3 h-3 rounded-full shadow-elevation-1 ${top.color}`} />
            {suppressed > 0 && (
              <span className="absolute -bottom-1.5 -right-1 min-w-[12px] h-3 px-0.5 flex items-center justify-center typo-heading text-[8px] leading-none rounded-full bg-foreground/80 text-background shadow-elevation-1">
                +{suppressed}
              </span>
            )}
          </>
        )}
      </span>
    </Tooltip>
  );
}
