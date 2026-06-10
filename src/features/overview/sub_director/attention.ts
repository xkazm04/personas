import type { DirectorRosterEntry } from '@/api/director';

/**
 * Attention model — the triage lenses applied to each in-scope persona. Pure,
 * client-side, derived from the portfolio roster (no backend). Shared by the
 * coaching table (per-row tags + sort) and the persona detail modal.
 */

export type AttentionFlag = 'needs_review' | 'low' | 'declining' | 'stale';

/** A review older than this is "stale". */
export const STALE_MS = 14 * 24 * 60 * 60 * 1000;

/** Priority order — lower index = more urgent. Drives sort + row accent + the triage bar. */
export const ATTENTION_ORDER: AttentionFlag[] = ['needs_review', 'low', 'declining', 'stale'];
const PRIORITY = ATTENTION_ORDER;

/** Tone (CSS color var) per flag. */
export const FLAG_TONE: Record<AttentionFlag, string> = {
  needs_review: 'var(--status-info)',
  low: 'var(--status-error)',
  declining: 'var(--status-warning)',
  stale: 'var(--muted-foreground)',
};

/** Every attention flag that applies to one roster entry (a persona can carry several). */
export function attentionFlags(r: DirectorRosterEntry, now: number): AttentionFlag[] {
  if (r.latestScore == null) return ['needs_review'];
  const flags: AttentionFlag[] = [];
  if (r.latestScore <= 2) flags.push('low');
  if (
    r.scoreTrend.length >= 2 &&
    r.scoreTrend[r.scoreTrend.length - 1]! < r.scoreTrend[r.scoreTrend.length - 2]!
  ) {
    flags.push('declining');
  }
  if (r.lastReviewedAt && now - new Date(r.lastReviewedAt).getTime() > STALE_MS) {
    flags.push('stale');
  }
  return flags;
}

/** The single most-urgent flag (for row accent + sort rank); null when clear. */
export function primaryFlag(flags: AttentionFlag[]): AttentionFlag | null {
  for (const f of PRIORITY) if (flags.includes(f)) return f;
  return null;
}

/** Sort rank — flagged personas first, by priority; clear personas last. */
export function attentionRank(flags: AttentionFlag[]): number {
  const p = primaryFlag(flags);
  return p ? PRIORITY.indexOf(p) : PRIORITY.length;
}

/** Portfolio-wide tally of how many roster entries carry each attention flag. */
export function attentionCounts(
  roster: DirectorRosterEntry[],
  now: number,
): Record<AttentionFlag, number> {
  const counts: Record<AttentionFlag, number> = { needs_review: 0, low: 0, declining: 0, stale: 0 };
  for (const r of roster) for (const f of attentionFlags(r, now)) counts[f] += 1;
  return counts;
}
