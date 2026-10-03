/**
 * What is left of the old panel's constants (kit batch home-3).
 *
 * The violet / sky / amber `SECTION_STYLES` table went: it coloured each environment by a
 * hardcoded palette step, which said nothing about whether anything was wrong, and the doctrine
 * forbids colour by hue. Status is now the only thing coloured, by meaning, through the kit's
 * `Tone x Glyph` (`healthModel.ts`). `SECTION_ICONS` and `SKELETON_SECTIONS` went with it -- the
 * six section names are `t.system_health.category_*` (`healthModel.sectionLabel`) and the six
 * sections are `healthModel.HEALTH_SECTION_IDS`, so the list can no longer drift from the
 * commands it stands for.
 *
 * Only `CrashLogsSection`'s own ghost geometry stays here.
 */

/** Calm ghost-bar styling for the crash-log placeholder (docs/design/overview-loading.md §C) -- no `animate-pulse`, ever. */
export const HEALTH_GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Deterministic width variation so stacked ghost bars read as text, not a barcode. */
export const HEALTH_GHOST_WIDTHS = ['w-36', 'w-28', 'w-40'];
