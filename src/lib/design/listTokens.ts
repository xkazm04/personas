/**
 * Shared design tokens for list and row-based UI components.
 *
 * Single source of truth for separator styles across event lists,
 * message lists, chat views, and other row-based layouts.
 */

/** Border class for row separators in list views (bottom border). */
export const ROW_SEPARATOR = 'border-primary/[0.06]';

/** Full border-b class for convenience: `border-b border-primary/[0.06]` */
export const ROW_SEPARATOR_B = `border-b ${ROW_SEPARATOR}`;

/** Full border-t class for convenience: `border-t border-primary/[0.06]` */
export const ROW_SEPARATOR_T = `border-t ${ROW_SEPARATOR}`;
