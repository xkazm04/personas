import { attentionFlags, type AttentionFlag } from './attention';
import { rosterMomentum, type Momentum } from './momentum';
import type { DirectorRosterEntry } from '@/api/director';

/**
 * Shared coaching-table facet filter. One facet is active at a time and any of
 * four surfaces can drive it: the attention-triage chips (a flag), the score
 * distribution bands (a score), the momentum summary (a momentum bucket), or the
 * table's own "only flagged" toggle. The state lives in DirectorCoachingTab so
 * all of them stay in sync.
 */
export type RosterFilter =
  | { type: 'flagged' }
  | { type: 'flag'; flag: AttentionFlag }
  | { type: 'score'; score: number }
  | { type: 'momentum'; momentum: Momentum };

/** Whether a roster row passes the active facet, given its derived signals. */
export function rosterRowMatches(
  filter: RosterFilter | null,
  flags: AttentionFlag[],
  latestScore: number | null,
  momentum: Momentum,
): boolean {
  if (!filter) return true;
  switch (filter.type) {
    case 'flagged':
      return flags.length > 0;
    case 'flag':
      return flags.includes(filter.flag);
    case 'score':
      return latestScore === filter.score;
    case 'momentum':
      return momentum === filter.momentum;
  }
}

/** Two facets are equal when type and payload match. */
export function sameFilter(a: RosterFilter | null, b: RosterFilter | null): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'flag' && b.type === 'flag') return a.flag === b.flag;
  if (a.type === 'score' && b.type === 'score') return a.score === b.score;
  if (a.type === 'momentum' && b.type === 'momentum') return a.momentum === b.momentum;
  return true;
}

/** Toggle helper — re-selecting the active facet clears the filter. */
export function toggleFilter(current: RosterFilter | null, next: RosterFilter): RosterFilter | null {
  return sameFilter(current, next) ? null : next;
}

/** The roster entries that pass the active facet (all of them when no filter). */
export function filterRoster(
  roster: DirectorRosterEntry[],
  filter: RosterFilter | null,
  now: number,
): DirectorRosterEntry[] {
  if (!filter) return roster;
  return roster.filter((r) => rosterRowMatches(filter, attentionFlags(r, now), r.latestScore, rosterMomentum(r)));
}
