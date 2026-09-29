/**
 * Layer 1 of the pad — the desk.
 *
 * The four-column card grid that lived here was retired on 2026-09-23. It did
 * not scale: measured on 90 goals across 16 projects it ran twenty-three rows
 * deep, and the A/B switcher that carried both layouts has done its job. The
 * journal is now the only desk, so the name the app imports resolves straight
 * to it and nothing else changes at the call site (`NotepadOverlayHost`).
 *
 * The cards themselves are NOT gone: `NoteDeskCard` is what the journal's
 * project interlayer renders (`questlog/QuestRoom.tsx`), which is the surface
 * a card was always the right shape for — one project at a time.
 */
export { QuestLogOverview as NoteOverview } from './questlog/QuestLogOverview';
