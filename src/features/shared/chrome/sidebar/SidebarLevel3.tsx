/**
 * Sidebar Level 3 — push/slide pane that replaces the Level 2 list when a
 * module elects to surface a deeper navigation layer.
 *
 * Visual contract:
 * - Header is a single full-width back row: chevron-left icon + label.
 *   Clicking it fires `onBack`; the caller is responsible for flipping its
 *   own state so the parent stops rendering this component.
 * - Body is a vertical list of nav items, styled to match SidebarSubNav
 *   rows (active = `bg-primary/10 text-foreground/90`, hover = subtle).
 * - Optional pill renderer for per-item status badges (e.g. release status
 *   like "Current" / "Alpha"). Kept opt-in so the primitive stays generic.
 *
 * Animation: slides in from the right (~180ms) via framer-motion. The L2
 * underneath simply unmounts — the entry animation alone produces the
 * "push" impression the user signed off on without requiring L2 to also
 * animate out.
 */
import { motion } from 'framer-motion';
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SidebarLevel3Item {
  id: string;
  icon?: LucideIcon;
  label: string;
  /** Optional renderer for an inline pill to the right of the label. */
  rightSlot?: ReactNode;
  /**
   * Optional renderer for a secondary row beneath the label (indented to
   * align with the label, not the icon). Use for tags/badges that
   * shouldn't compete with the label on the same line — e.g. release
   * status pills under a release version row.
   */
  belowRow?: ReactNode;
}

export interface SidebarLevel3Props {
  /** Text shown next to the back-arrow. */
  backLabel: string;
  onBack: () => void;
  items: SidebarLevel3Item[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Optional aria-label for the nav list. */
  ariaLabel?: string;
  /**
   * Optional content rendered between the back-row and the nav list.
   * Useful for context pills (e.g. "active project", "active twin") that
   * scope the L3 contents.
   */
  subHeader?: ReactNode;
}

export default function SidebarLevel3({
  backLabel,
  onBack,
  items,
  activeId,
  onSelect,
  ariaLabel,
  subHeader,
}: SidebarLevel3Props) {
  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col h-full"
    >
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 px-3 py-3 border-b border-primary/10 text-foreground hover:bg-secondary/40 hover:text-foreground/90 transition-colors text-left"
      >
        <ChevronLeft className="w-4 h-4 flex-shrink-0" />
        <span className="typo-label">{backLabel}</span>
      </button>

      {subHeader && (
        <div className="px-3 py-2 border-b border-primary/8">{subHeader}</div>
      )}

      <nav
        className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto"
        role="tablist"
        aria-label={ariaLabel ?? backLabel}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeId === item.id;
          const hasBelowRow = !!item.belowRow;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              data-testid={`l3-nav-${item.id}`}
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              className={`w-full flex ${hasBelowRow ? 'items-start' : 'items-center'} gap-2.5 px-3 py-2 rounded-lg typo-heading transition-colors ${
                isActive
                  ? 'bg-primary/10 text-foreground font-semibold'
                  : 'text-foreground/70 hover:bg-secondary/40 hover:text-foreground font-normal'
              }`}
            >
              {Icon && (
                <Icon className={`w-4 h-4 flex-shrink-0 ${hasBelowRow ? 'mt-0.5' : ''}`} />
              )}
              <span className="flex-1 min-w-0 text-left">
                <span className="flex items-center gap-2">
                  <span className="truncate min-w-0 flex-1">{item.label}</span>
                  {item.rightSlot && (
                    <span className="ml-auto flex-shrink-0">{item.rightSlot}</span>
                  )}
                </span>
                {hasBelowRow && (
                  <span className="mt-1 flex">{item.belowRow}</span>
                )}
              </span>
            </button>
          );
        })}
      </nav>
    </motion.div>
  );
}
