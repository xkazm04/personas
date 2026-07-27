/**
 * SidebarGroupNav — the canonical Level-2 layout for every sidebar section.
 *
 * The Projects (`teams`) L2 nav established the house pattern and this
 * primitive generalizes it so Home / Overview / Agents / Events / Connections
 * / Settings / Plugins all read as one system instead of six bespoke lists:
 *
 *   [lead row]                     ← optional, full-size, no divider above
 *   ─────────────────────────────  ← `mt-3 pt-3 border-t border-primary/10`
 *   GROUP LABEL                    ← label-only header (caption, uppercase)
 *   │ ○ child                      ← nested behind `border-l`, typo-body
 *   │ ○ child
 *   ─────────────────────────────
 *   ...
 *
 * A group header can also be *navigable* (pass `groupItem`) — that's the
 * Goals / KPIs shape in Projects, where the header itself is a destination and
 * the nested rows are its views.
 *
 * Groups can carry arbitrary bodies (`render`) instead of `items` — used by the
 * Agents nav, whose groups are dynamic (draft builds, per-project rosters) and
 * need row shapes this primitive shouldn't try to model.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSidebarLabels } from '@/i18n/useSidebarTranslation';
import type { SubNavBadge, SubNavIndicator } from '@/features/shared/chrome/sidebar/SidebarSubNav';

export interface GroupNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Numeric count pill pinned right. */
  badge?: SubNavBadge;
  /** Presence dot pinned right (e.g. the "What's New" nudge). */
  indicator?: SubNavIndicator;
  /** Arbitrary right-edge content (running pulse, dev pill, …). */
  rightSlot?: ReactNode;
  /** Renders with the golden dev-only treatment. */
  dev?: boolean;
  testId?: string;
  title?: string;
  /** Overrides the nav-wide `onSelect` for this row. */
  onSelect?: () => void;
}

export interface SidebarNavGroup {
  id: string;
  /** Group heading. Omit to render the items with no header (rare). */
  label?: string;
  /**
   * When set, the heading itself is a navigable destination rendered at
   * lead-row size (the Goals / KPIs shape). Otherwise the heading is a
   * label-only caption.
   */
  groupItem?: GroupNavItem;
  /** Small leading glyph for a label-only heading. */
  icon?: LucideIcon;
  /** Tailwind text color for a label-only heading (defaults to muted). */
  accentClass?: string;
  /** Count shown next to a label-only heading. */
  count?: number;
  items?: GroupNavItem[];
  /** Escape hatch: arbitrary body rendered inside the nested rail. */
  render?: ReactNode;
  /** Adds a chevron toggle to the heading. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Skips the divider above this group (use for the first group only). */
  flush?: boolean;
}

interface SidebarGroupNavProps {
  groups: SidebarNavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Fires on pointerenter for a row — use for route-level prefetch. */
  onHoverItem?: (id: string) => void;
  /** Full-size row above the first group, with no divider between them. */
  lead?: GroupNavItem;
  ariaLabel: string;
  /** Per-row label override keyed by item id (id collisions across sections). */
  labelOverrides?: Record<string, string>;
  children?: ReactNode;
}

// Row styling lives in these two helpers so every consumer of the pattern —
// including the bespoke bodies passed through `render` — can reuse the exact
// same classes instead of re-deriving them.

/** Full-size row: the lead entry and navigable group headers. */
export function leadRowClass(active: boolean, dev = false): string {
  const base = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors';
  const ring = dev ? ' ring-1 ring-amber-500/40' : '';
  return `${base}${ring} ${
    active
      ? 'bg-primary/10 text-foreground font-semibold'
      : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
  }`;
}

/** Nested row: everything inside a group's left rail. */
export function childRowClass(active: boolean, dev = false): string {
  const base = 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md typo-body transition-colors';
  const ring = dev ? ' ring-1 ring-amber-500/40' : '';
  return `${base}${ring} ${
    active
      ? 'bg-primary/10 text-foreground/90 font-medium'
      : 'text-foreground/70 hover:bg-secondary/30 hover:text-foreground/90'
  }`;
}

/** The nested rail wrapper — `ml-3 pl-2 border-l`. */
export const GROUP_RAIL_CLASS = 'ml-3 pl-2 border-l border-primary/10 space-y-0.5';

/** The divider + spacing above a group block. */
export const GROUP_BLOCK_CLASS = 'mt-3 pt-3 border-t border-primary/10';

/** Label-only group heading. */
export const GROUP_LABEL_CLASS = 'px-3 pb-1 typo-caption uppercase tracking-wider';

function RightAdornments({ item }: { item: GroupNavItem }) {
  return (
    <>
      {item.badge && item.badge.count > 0 && (
        <span className={`ml-auto px-1.5 py-0.5 typo-caption leading-none rounded-full ${item.badge.className}`}>
          {item.badge.count}
        </span>
      )}
      {item.indicator && (
        <Tooltip content={item.indicator.label} placement="right" delay={300}>
          <span
            className={`${item.badge && item.badge.count > 0 ? 'ml-1.5' : 'ml-auto'} relative inline-flex h-2.5 w-2.5 flex-shrink-0 items-center justify-center ${item.indicator.onClick ? 'cursor-pointer' : ''}`}
            aria-label={item.indicator.label}
            onClick={item.indicator.onClick ? (e) => { e.stopPropagation(); item.indicator!.onClick!(e); } : undefined}
          >
            {item.indicator.pulse && (
              <span className={`absolute inset-0 rounded-full animate-ping ${item.indicator.color} opacity-60`} />
            )}
            <span className={`relative h-2 w-2 rounded-full shadow-elevation-1 ${item.indicator.color}`} />
          </span>
        </Tooltip>
      )}
      {item.rightSlot && (
        <span className={item.badge?.count || item.indicator ? 'ml-1.5 flex-shrink-0' : 'ml-auto flex-shrink-0'}>
          {item.rightSlot}
        </span>
      )}
    </>
  );
}

export default function SidebarGroupNav({
  groups,
  activeId,
  onSelect,
  onHoverItem,
  lead,
  ariaLabel,
  labelOverrides,
  children,
}: SidebarGroupNavProps) {
  const labelOf = useSidebarLabels();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of groups) if (g.defaultCollapsed) initial[g.id] = true;
    return initial;
  });
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const resolveLabel = (item: GroupNavItem) =>
    labelOverrides?.[item.id] ?? labelOf(item.id, item.label);

  const renderRow = (item: GroupNavItem, size: 'lead' | 'child') => {
    const Icon = item.icon;
    const active = activeId === item.id;
    const className = size === 'lead' ? leadRowClass(active, item.dev) : childRowClass(active, item.dev);
    return (
      <button
        type="button"
        key={item.id}
        data-testid={item.testId ?? `tab-${item.id}`}
        onClick={item.onSelect ?? (() => onSelect(item.id))}
        onPointerEnter={onHoverItem ? () => onHoverItem(item.id) : undefined}
        aria-current={active ? 'page' : undefined}
        title={item.title}
        className={className}
      >
        <Icon className={`${size === 'lead' ? 'w-4 h-4' : 'w-3.5 h-3.5'} flex-shrink-0 ${item.dev ? 'text-amber-400' : ''}`} />
        <span className="truncate text-left min-w-0">{resolveLabel(item)}</span>
        <RightAdornments item={item} />
      </button>
    );
  };

  return (
    <nav className="space-y-1" aria-label={ariaLabel}>
      {lead && renderRow(lead, 'lead')}

      {groups.map((group, index) => {
        const isCollapsed = collapsed[group.id] === true;
        const HeadingIcon = group.icon;
        const flush = group.flush ?? (!lead && index === 0);
        const headingId = `sidebar-group-${group.id}`;
        return (
          <div key={group.id} className={flush ? 'space-y-0.5' : `${GROUP_BLOCK_CLASS} space-y-0.5`}>
            {group.groupItem
              ? renderRow(group.groupItem, 'lead')
              : group.label && (
                group.collapsible ? (
                  <button
                    type="button"
                    id={headingId}
                    onClick={() => toggle(group.id)}
                    aria-expanded={!isCollapsed}
                    className={`w-full flex items-center gap-2 ${GROUP_LABEL_CLASS} pt-0 py-1.5 transition-colors ${group.accentClass ?? 'text-foreground/50 hover:text-foreground/70'}`}
                  >
                    {HeadingIcon && <HeadingIcon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />}
                    <span className="truncate min-w-0">{group.label}</span>
                    {group.count != null && group.count > 0 && (
                      <span className="typo-caption font-mono opacity-70">{group.count}</span>
                    )}
                    <ChevronDown className={`w-3 h-3 ml-auto flex-shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                  </button>
                ) : (
                  <div
                    id={headingId}
                    className={`flex items-center gap-2 ${GROUP_LABEL_CLASS} ${group.accentClass ?? 'text-foreground/50'}`}
                  >
                    {HeadingIcon && <HeadingIcon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />}
                    <span className="truncate min-w-0">{group.label}</span>
                    {group.count != null && group.count > 0 && (
                      <span className="typo-caption font-mono opacity-70">{group.count}</span>
                    )}
                  </div>
                )
              )}
            {!isCollapsed && (
              <div className={GROUP_RAIL_CLASS} aria-labelledby={group.label ? headingId : undefined}>
                {group.items?.map((item) => renderRow(item, 'child'))}
                {group.render}
              </div>
            )}
          </div>
        );
      })}

      {children}
    </nav>
  );
}
