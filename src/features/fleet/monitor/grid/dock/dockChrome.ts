// The dispatch dock's chip chrome, shared by the toolbar, the readings and the
// resting row (and by `DockLandingPill`, which `DockParts` imports: a module of
// its own so neither imports the other's constants).

/**
 * The dock's ONE chip chrome (polish P2, 2026-10-16): the command bar's window
 * (`CommandBar` tally and lanes: `ae-win` glass, `rounded-input`, caption
 * type, a lamp tone only when set), so the toolbar, the readings and the
 * resting row read as the same panel as the bar above the board. `DOCK_CHIP`
 * is for a control (it takes the focus ring), `DOCK_READING` for a reading.
 * A set control adds `DOCK_CHIP_ON` (a lit run-tone window, as a pressed chip
 * in the bar).
 */
export const DOCK_READING = 'ae-win inline-flex h-6 flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-input px-2 typo-caption';
export const DOCK_CHIP = 'ae-win ae-focus h-7 flex-shrink-0 whitespace-nowrap rounded-input px-2.5 typo-caption text-foreground';
export const DOCK_CHIP_ON = 'is-lit ae-t-run';

