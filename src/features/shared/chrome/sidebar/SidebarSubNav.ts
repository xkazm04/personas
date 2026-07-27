/**
 * Shared Level-2 nav item shapes.
 *
 * This module used to also export the flat `SidebarSubNav` list component.
 * Every section moved to the grouped {@link SidebarGroupNav} layout on
 * 2026-07-27, so only the data shapes survive — they are still the vocabulary
 * `sidebarData.ts` and every nav consumer speak.
 */
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

/**
 * A small status dot pinned to the right edge of a sub-nav row — e.g. the
 * "What's New" update nudge on the Roadmap item. Distinct from {@link SubNavBadge}
 * (a numeric count pill); this is a presence indicator with an optional pulse.
 */
export interface SubNavIndicator {
  /** Tailwind classes for the dot (bg + optional border/shadow). */
  color: string;
  /** Accessible label / tooltip text describing what the dot means. */
  label: string;
  /** Soft ping ring to draw the eye (use for genuinely new, time-sensitive cues). */
  pulse?: boolean;
  /**
   * Optional dismiss handler. When provided the dot becomes clickable and the
   * click is kept from triggering the row's `onSelect`. When omitted the dot is
   * decorative and is expected to clear via a side effect of selecting the row.
   */
  onClick?: (e: React.MouseEvent) => void;
}
