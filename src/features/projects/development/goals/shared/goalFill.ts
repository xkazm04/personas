/**
 * Goal fill — the completion gauge a goal wears: the share of its width that is
 * painted, and the colour it is painted in. Emerald when a checklist drives the
 * number, violet when it is a manual progress nudge.
 */
export const GOAL_FILL_CHECKLIST = 'rgba(16,185,129,0.16)';
export const GOAL_FILL_MANUAL = 'rgba(139,92,246,0.14)';

/** Percent filled, 0..100: the checklist ratio when there is a checklist, else the manual progress. */
export function goalFillPct(done: number, total: number, progress: number | null | undefined): number {
  const raw = total > 0 ? Math.round((done / total) * 100) : (progress ?? 0);
  return Math.min(100, Math.max(0, raw));
}
