import { describe, expect, it } from 'vitest';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { mergeTaggedRows, rowCallsign, rowToken } from '../lensModel';
import type { FeedTeam, TaggedItem } from '../types';

/* ----------------------------------------------------------------------------
 * REGRESSION — "the Timeline shows duplicated System messages".
 *
 * Nothing was duplicated in the read model: `read_channel` returns each fact
 * once, with the discriminator on board (`kind` for the voice, `label` for the
 * machine token). The Stream threw both away — it signed every row without a
 * resolvable persona "SYSTEM", and rendered the LENS kind ("step") instead of
 * the row's own label. So one step's `step_running` and `step_done` — which
 * carry the same body, the step title — came out as two byte-identical lines,
 * and a user directive answered by Athena came out as SYSTEM twice.
 *
 * Measured on the dev database before the fix: 231 adjacent pairs of rows that
 * rendered identically, 185 of them a `step_done` sitting directly under its
 * own `step_running`.
 * -------------------------------------------------------------------------- */

function item(over: Partial<TeamChannelItem> = {}): TeamChannelItem {
  return {
    id: 'i1',
    kind: 'step',
    at: '2026-06-07T21:52:19Z',
    personaId: null,
    label: 'step_running',
    body: 'Test and merge the PR',
    assignmentId: 'a1',
    stepId: 's1',
    extra: null,
    replyTo: null,
    deliberationId: null,
    importance: null,
    consumers: null,
    ...over,
  };
}

const team: FeedTeam = { teamId: 't1', teamName: 'SDLC', teamColor: '#fff', members: [] };
const tag = (i: TeamChannelItem): TaggedItem => ({ item: i, team });

/** The three fields the log row actually shows: callsign · token · summary. */
function signature(i: TeamChannelItem, personaName?: string): string {
  return `${rowCallsign(i, personaName)}|${rowToken(i)}|${i.body ?? ''}`;
}

describe('step lifecycle rows are not each other', () => {
  it('gives a step its own machine token, so start and finish differ', () => {
    // The concrete pair from the dev DB: same step, same title, same callsign.
    const running = item({ id: 'tae-82d3c249', label: 'step_running' });
    const done = item({ id: 'tae-4740205f', label: 'step_done', at: '2026-06-07T23:36:42Z' });

    expect(rowToken(running)).toBe('step_running');
    expect(rowToken(done)).toBe('step_done');
    expect(signature(running)).not.toBe(signature(done));
  });

  it('keeps every step-layer kind distinguishable', () => {
    const kinds = [
      'created',
      'step_running',
      'step_done',
      'step_failed',
      'step_skipped',
      'status_awaiting_review',
      'status_done',
      'qa_changes_requested_rework',
    ];
    const tokens = kinds.map((label) => rowToken(item({ label })));
    expect(new Set(tokens).size).toBe(kinds.length);
  });

  it('still shows an event its raw event_type and a memory its lens kind', () => {
    expect(rowToken(item({ kind: 'event', label: 'qa.pr.approved' }))).toBe('qa.pr.approved');
    expect(rowToken(item({ kind: 'memory', label: 'decision' }))).toBe('memory');
    expect(rowToken(item({ kind: 'persona', label: 'persona' }))).toBe('message');
  });
});

describe('every voice signs its own name', () => {
  it('no longer collapses You / Athena / Director into SYSTEM', () => {
    expect(rowCallsign(item({ kind: 'directive', label: 'user' }), undefined)).toBe('YOU');
    expect(rowCallsign(item({ kind: 'athena', label: 'Athena' }), undefined)).toBe('ATHENA');
    expect(rowCallsign(item({ kind: 'director', label: 'Director' }), undefined)).toBe('DIRECTOR');
  });

  it('keeps SYSTEM for the genuinely unattributed machine rows', () => {
    expect(rowCallsign(item({ kind: 'system', label: 'system' }), undefined)).toBe('SYSTEM');
    expect(rowCallsign(item(), undefined)).toBe('SYSTEM'); // an unassigned step
  });

  it('prefers the resolved persona, and never renames a bridged human', () => {
    expect(rowCallsign(item({ kind: 'persona', personaId: 'p1' }), 'T: QA Guardian')).toBe('QA-GUARDIAN');
    expect(rowCallsign(item({ kind: 'slack', personaId: 'U123', label: 'Dana Reyes' }), 'T: QA Guardian'))
      .toBe('DANA-REYES');
  });

  it('separates a directive from the answer it gets', () => {
    const ask = item({ id: 'tcm-1', kind: 'directive', label: 'user', body: 'Ship it' });
    const answer = item({ id: 'tcm-2', kind: 'athena', label: 'Athena', body: 'Ship it' });
    expect(signature(ask)).not.toBe(signature(answer));
  });
});

describe('cross-team merge', () => {
  it('renders a fact visible through two teams exactly once', () => {
    // A bus event authored by a persona who belongs to two teams comes back in
    // BOTH teams' pages, under the same namespaced id.
    const other: FeedTeam = { ...team, teamId: 't2' };
    const shared = item({ id: 'pe-abc', kind: 'event', label: 'qa.pr.approved', personaId: 'p1' });
    const merged = mergeTaggedRows([[tag(shared)], [{ item: shared, team: other }]]);
    expect(merged).toHaveLength(1);
  });

  it('ranks by (at, id) desc and keeps genuinely distinct rows', () => {
    const a = item({ id: 'tae-1', at: '2026-06-07T21:52:19Z' });
    const b = item({ id: 'tae-2', at: '2026-06-07T21:52:19Z', label: 'step_done' });
    const c = item({ id: 'tae-3', at: '2026-06-07T23:36:42Z' });
    const merged = mergeTaggedRows([[tag(a), tag(c)], [tag(b)]]);
    expect(merged.map((r) => r.item.id)).toEqual(['tae-3', 'tae-2', 'tae-1']);
  });
});
