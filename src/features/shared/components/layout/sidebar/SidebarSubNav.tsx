import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SubNavItem {
  id: string;
  icon: LucideIcon;
  label: string;
  /** Minimum tier required to show this item. */
  minTier?: import('@/lib/constants/uiModes').Tier;
  devOnly?: boolean;
  /** @deprecated Use minTier instead */
  simpleHidden?: boolean;
}

export interface SubNavBadge {
  count: number;
  /** Tailwind classes for the badge pill (bg, text, border) */
  className: string;
}

export default function SidebarSubNav({
  items,
  activeId,
  onSelect,
  badges = {},
  variant = 'compact',
  devItems,
  children,
}: {
  items: SubNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  badges?: Record<string, SubNavBadge>;
  variant?: 'overview' | 'compact';
  devItems?: Set<string>;
  children?: ReactNode;
}) {
  const isOverview = variant === 'overview';
  const boxSize = isOverview ? 'w-8 h-8' : 'w-7 h-7';
  const iconSize = isOverview ? 'w-4 h-4' : 'w-3.5 h-3.5';

  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeId === item.id;
        const badge = badges[item.id];
        const isDevItem = devItems?.has(item.id);

        return (
          <button
            key={item.id}
            data-testid={`tab-${item.id}`}
            onClick={() => onSelect(item.id)}
            className={`w-full flex items-center ${isOverview ? 'gap-3 px-3 py-2.5' : 'gap-2.5 p-2.5'} mb-1 rounded-xl border transition-all text-left ${
              isActive
                ? isDevItem
                  ? 'bg-amber-500/8 border-amber-500/35'
                  : 'bg-primary/10 border-primary/20'
                : isDevItem
                  ? 'bg-amber-500/5 border-amber-500/25 hover:bg-amber-500/10'
                  : isOverview
                    ? 'hover:bg-secondary/50 border-transparent'
                    : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
            }`}
          >
            <div className={`${boxSize} rounded-lg flex items-center justify-center border transition-colors ${
              isActive
                ? 'bg-primary/15 border-primary/25'
                : 'bg-secondary/40 border-primary/15'
            }`}>
              <Icon className={`${iconSize} ${isActive ? 'text-primary' : 'text-muted-foreground/90'}`} />
            </div>
            <span className={`text-sm ${isActive ? 'font-semibold text-foreground' : isOverview ? 'font-medium text-foreground/80' : 'font-medium text-muted-foreground/90'}`}>
              {item.label}
            </span>
            {badge && badge.count > 0 && (
              <span className={`ml-auto px-1.5 py-0.5 text-sm font-bold leading-none rounded-full ${badge.className}`}>
                {badge.count}
              </span>
            )}
          </button>
        );
      })}
      {children}
    </>
  );
}
