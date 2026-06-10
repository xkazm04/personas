import type { AttentionFlag } from './attention';

/**
 * Shared coaching-table facet filter. One facet is active at a time and any of
 * three surfaces can drive it: the attention-triage chips (a flag), the score
 * distribution bands (a score), or the table's own "only flagged" toggle. The
 * state lives in DirectorCoachingTab so all three stay in sync.
 */
export type RosterFilter =
  | { type: 'flagged' }
  | { type: 'flag'; flag: AttentionFlag }
  | { type: 'score'; score: number };

/** Whether a roster row (its attention flags + latest score) passes the facet. */
export function rosterRowMatches(
  filter: RosterFilter | null,
  flags: AttentionFlag[],
  latestScore: number | null,
): boolean {
  if (!filter) return true;
  switch (filter.type) {
    case 'flagged':
      return flags.length > 0;
    case 'flag':
      return flags.includes(filter.flag);
    case 'score':
      return latestScore === filter.score;
  }
}

/** Two facets are equal when type and payload match. */
export function sameFilter(a: RosterFilter | null, b: RosterFilter | null): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'flag' && b.type === 'flag') return a.flag === b.flag;
  if (a.type === 'score' && b.type === 'score') return a.score === b.score;
  return true;
}

/** Toggle helper — re-selecting the active facet clears the filter. */
export function toggleFilter(current: RosterFilter | null, next: RosterFilter): RosterFilter | null {
  return sameFilter(current, next) ? null : next;
}
