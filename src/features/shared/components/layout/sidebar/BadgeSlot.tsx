import { useMemo } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useIsDarkTheme } from '@/stores/themeStore';

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

/** Dark-theme translucent variants for count badge colors. */
const DARK_BADGE_COLORS: Record<string, string> = {
  'bg-amber-500 shadow-amber-500/30': 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  'bg-blue-500 shadow-blue-500/30': 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  'bg-red-500 shadow-red-500/30': 'bg-red-500/20 text-red-400 border border-red-500/30',
  'bg-emerald-500 shadow-emerald-500/30': 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  'bg-violet-500 shadow-violet-500/30': 'bg-violet-500/20 text-violet-400 border border-violet-500/30',
};

/** Theme-aware count badge: solid pill in light themes, translucent in dark themes. */
function CountBadge({ badge, suppressed = 0 }: { badge: BadgeDefinition; suppressed?: number }) {
  const isDark = useIsDarkTheme();
  const darkVariant = DARK_BADGE_COLORS[badge.color];
  return (
    <span className={`min-w-[16px] h-4 px-1 flex items-center justify-center typo-heading leading-none rounded-full shadow-elevation-1 ${
      isDark && darkVariant ? darkVariant : `text-white ${badge.color}`
    }`}>
      {(badge.count ?? 0) > 99 ? '99+' : badge.count}
      {suppressed > 0 && <span className="ml-0.5 text-[8px] opacity-80">+{suppressed}</span>}
    </span>
  );
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

  const tooltipText = activeBadges.map((b) => b.label).join(' · ');

  // Dual count badges: show two count badges side-by-side (e.g. messages + approvals)
  const countBadges = activeBadges.filter((b) => b.variant === 'count');

  if (countBadges.length >= 2) {
    return (
      <Tooltip content={tooltipText} placement="right" delay={300}>
        <span className="absolute -top-1 -left-1 right-0 z-20 flex items-center justify-between pointer-events-none">
          <CountBadge badge={countBadges[0]!} />
          <CountBadge badge={countBadges[1]!} />
        </span>
      </Tooltip>
    );
  }

  const suppressed = activeBadges.length - 1;
  const handleClick = top.onClick
    ? (e: React.MouseEvent) => { e.stopPropagation(); top.onClick!(e); }
    : undefined;

  return (
    <Tooltip content={tooltipText} placement="right" delay={300}>
      <span
        className={`absolute top-0.5 right-0.5 z-20 min-w-[16px] h-4 flex items-center justify-center ${top.onClick ? 'cursor-pointer' : ''}`}
        onClick={handleClick}
      >
        {top.variant === 'count' && <CountBadge badge={top} suppressed={suppressed} />}

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
