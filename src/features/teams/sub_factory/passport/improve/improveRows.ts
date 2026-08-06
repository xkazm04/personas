// Row-key constants for the improve layer. Deliberately component-free.
//
// These used to live next to the components that consume them
// (`DATABASE_DIMENSION` in DatabaseModal.tsx, `STANDARDS_ROWS` in
// ImproveCell.tsx). That was fine until `dimActions.ts` — a pure predicate
// module the Mastermind canvas calls for every cell of every island — needed to
// know which rows open a modal. Importing that from `ImproveSurface.tsx` pulled
// the whole modal tree (and its `connectors` dependency) into a logic module,
// which broke a unit test that mocks `connectors` and would have loaded four
// modals' worth of code to answer "is this cell clickable".
//
// Constants that both a component and a predicate need belong in neither.
export const DATABASE_DIMENSION = 'persistence';
export const MONITORING_DIMENSION = 'monitoring';

/** Rows whose improve action is a pure Tier-0 config toggle (ImprovePopover).
 *  Security moved to the deploy/scan path (DeployPopover) so it can offer a
 *  real security scan + the level ladder, not just the generic toggles. */
export const STANDARDS_ROWS = new Set(['ci', 'selfverify']);

/** Rows that open a full modal rather than an anchored popover.
 *
 *  These are DECLARATION surfaces — bind a connector per environment, per
 *  capability, adopt/share a skill — not gap-filling deploys. So they stay
 *  actionable even when nothing is missing: "everything is wired" is exactly
 *  when you want to open it and see what is bound. */
export const MODAL_ROWS = new Set<string>(['skills', DATABASE_DIMENSION, MONITORING_DIMENSION]);
