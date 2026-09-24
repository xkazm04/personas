import { describe, expect, it } from 'vitest';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import {
  EMPTY_LENS, REMOVED_CALLSIGN, SPEAKER_REMOVED, SPEAKER_SYSTEM,
  facetCounts, matchesLens, rowCallsign, speakerKey,
} from '../lensModel';
import type { FeedTeam, TaggedItem } from '../types';

/* REGRESSION — "the callsign rail lists many 'System' rows that differ only by
 * colour". Every one was a DELETED persona: its author id no longer resolves,
 * so it signed SYSTEM with a colour hashed from the id. They now share ONE
 * "removed" bucket, and genuinely personaless machine rows get their own. */

function item(over: Partial<TeamChannelItem> = {}): TeamChannelItem {
  return {
    id: 'i1', kind: 'memory', at: '2026-09-20T10:00:00Z', personaId: null, label: 'decision',
    body: 'x', assignmentId: null, stepId: null, extra: null, replyTo: null,
    deliberationId: null, importance: null, consumers: null, ...over,
  };
}
const team: FeedTeam = { teamId: 't1', teamName: 'SDLC', teamColor: '#fff', members: [] };
const tag = (i: TeamChannelItem): TaggedItem => ({ item: i, team });
const nameOf = (pid: string | null) => (pid === 'alive' ? 'QA Guardian' : undefined);

describe('stream speakers', () => {
  it('keys a resolved persona by id, a deleted one as removed, a personaless row as system', () => {
    expect(speakerKey(item({ personaId: 'alive' }), nameOf)).toBe('alive');
    expect(speakerKey(item({ personaId: 'gone-1' }), nameOf)).toBe(SPEAKER_REMOVED);
    expect(speakerKey(item({ kind: 'step', label: 'step_done' }), nameOf)).toBe(SPEAKER_SYSTEM);
    expect(speakerKey(item({ kind: 'slack', personaId: 'U1' }), nameOf)).toBeNull();
  });

  it('collapses every deleted persona into ONE facet row', () => {
    const rows = ['gone-1', 'gone-2', 'gone-3', 'alive'].map((pid, i) => tag(item({ id: `i${i}`, personaId: pid })));
    const { callsigns } = facetCounts(rows, EMPTY_LENS, nameOf);
    expect(callsigns).toEqual([
      { key: SPEAKER_REMOVED, count: 3 },
      { key: 'alive', count: 1 },
    ]);
  });

  it('filters the removed and system buckets', () => {
    const lens = { ...EMPTY_LENS, callsigns: new Set([SPEAKER_SYSTEM]) };
    expect(matchesLens(tag(item({ kind: 'step', label: 'step_done' })), lens, nameOf)).toBe(true);
    expect(matchesLens(tag(item({ personaId: 'gone-1' })), lens, nameOf)).toBe(false);
  });

  it('signs a deleted persona REMOVED, not SYSTEM', () => {
    expect(rowCallsign(item({ personaId: 'gone-1' }), undefined)).toBe(REMOVED_CALLSIGN);
    expect(rowCallsign(item(), undefined)).toBe('SYSTEM');
  });
});
