// Mission Control — the overview "Mission control" tab (formerly "Home"), and
// since the 2026-08-25 monitoring consolidation the ONE monitoring surface:
// vitals + daily success trend, status monitor, leaderboard matrix,
// self-healing panel, heatmap, ticker, routines.
// Layer 1 is the Annunciator Wall (contest winner, 2026-10-04): a 4x2 wall of
// kit Tiles, one annunciator per OPERATOR QUESTION rather than per subsystem,
// each with a lamp, a state word, one figure, a drawn trace and one line of
// evidence. Layer 2 folds the wall into a lit rail while the chosen dimension's
// detail takes the window. `MissionControlHome` is kept as a named export: it
// is still what the page was, and nothing else imports it.
export { default } from './variants/annunciator-wall/AnnunciatorWall';
export { default as MissionControlHome } from './MissionControlHome';
