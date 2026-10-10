import { describe, expect, it } from 'vitest';
import {
  buildConversation,
  clusterStatus,
  dayLabel,
  goalText,
  looksLikeGoal,
  nextPromptBatch,
  reconcileRows,
  type QueuedPrompt,
} from '../conversationModel';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* ----------------------------------------------------------------------------
 * The fold is the whole readability argument of the Conversations surface, and
 * it had no test. Two properties matter and neither is visible from a render
 * test: the channel arrives NEWEST-FIRST and the conversation reads
 * OLDEST-FIRST, and clustering is by RUN — two bursts of one assignment
 * separated by chat are two rows, not one.
 * -------------------------------------------------------------------------- */

function item(id: string, at: string, patch: Partial<TeamChannelItem> = {}): TeamChannelItem {
  return {
    id,
    kind: 'directive',
    at,
    personaId: null,
    label: '',
    body: null,
    assignmentId: null,
    stepId: null,
    extra: null,
    replyTo: null,
    deliberationId: null,
    importance: null,
    consumers: null,
    ...patch,
  };
}

const step = (id: string, at: string, assignmentId: string, label = 'running') =>
  item(id, at, { kind: 'step', assignmentId, label });

const turn = (id: string, at: string, deliberationId: string) =>
  item(id, at, { kind: 'persona', deliberationId });

describe('buildConversation', () => {
  it('reverses a newest-first page into oldest-first rows', () => {
    const rows = buildConversation([
      item('c', '2026-08-24T12:00:00Z'),
      item('b', '2026-08-24T11:00:00Z'),
      item('a', '2026-08-24T10:00:00Z'),
    ]);
    expect(rows.filter((r) => r.kind === 'talk').map((r) => r.key)).toEqual([
      'talk:a',
      'talk:b',
      'talk:c',
    ]);
  });

  it('emits one day separator per calendar day, ahead of that day’s first row', () => {
    const rows = buildConversation([
      item('c', '2026-08-25T09:00:00Z'),
      item('b', '2026-08-24T11:00:00Z'),
      item('a', '2026-08-24T10:00:00Z'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['day', 'talk', 'talk', 'day', 'talk']);
    expect(rows[0]).toMatchObject({ key: 'day:2026-08-24' });
    expect(rows[3]).toMatchObject({ key: 'day:2026-08-25' });
  });

  it('clusters a run of steps sharing an assignment into one row, anchored at its newest event', () => {
    const rows = buildConversation([
      step('s3', '2026-08-24T10:02:00Z', 'asg-1'),
      step('s2', '2026-08-24T10:01:00Z', 'asg-1'),
      step('s1', '2026-08-24T10:00:00Z', 'asg-1'),
    ]);
    const cluster = rows.find((r) => r.kind === 'assignment');
    expect(rows.filter((r) => r.kind === 'assignment')).toHaveLength(1);
    expect(cluster).toMatchObject({ assignmentId: 'asg-1', at: '2026-08-24T10:02:00Z' });
    expect(cluster?.kind === 'assignment' && cluster.items.map((i) => i.id)).toEqual([
      's1',
      's2',
      's3',
    ]);
  });

  it('clusters by RUN — two bursts of one assignment split by talk stay two rows', () => {
    const rows = buildConversation([
      step('s3', '2026-08-24T10:03:00Z', 'asg-1'),
      item('t1', '2026-08-24T10:02:00Z'),
      step('s1', '2026-08-24T10:01:00Z', 'asg-1'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['day', 'assignment', 'talk', 'assignment']);
    expect(rows.filter((r) => r.kind === 'assignment').map((r) => r.key)).toEqual([
      'asg:asg-1:s1',
      'asg:asg-1:s3',
    ]);
  });

  it('does not merge steps of different assignments', () => {
    const rows = buildConversation([
      step('s2', '2026-08-24T10:01:00Z', 'asg-2'),
      step('s1', '2026-08-24T10:00:00Z', 'asg-1'),
    ]);
    expect(rows.filter((r) => r.kind === 'assignment').map((r) => r.key)).toEqual([
      'asg:asg-1:s1',
      'asg:asg-2:s2',
    ]);
  });

  it('clusters deliberation turns regardless of item kind, and takes precedence over the step rule', () => {
    const rows = buildConversation([
      turn('d2', '2026-08-24T10:01:00Z', 'del-1'),
      item('d1', '2026-08-24T10:00:00Z', {
        kind: 'step',
        assignmentId: 'asg-1',
        deliberationId: 'del-1',
      }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['day', 'deliberation']);
    const cluster = rows[1];
    expect(cluster?.kind === 'deliberation' && cluster.items.map((i) => i.id)).toEqual(['d1', 'd2']);
  });

  it('a day boundary breaks a cluster — a separator can never sit inside one', () => {
    const rows = buildConversation([
      step('s2', '2026-08-25T00:01:00Z', 'asg-1'),
      step('s1', '2026-08-24T23:59:00Z', 'asg-1'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['day', 'assignment', 'day', 'assignment']);
  });

  it('treats a step with no assignment, and every other kind, as talk', () => {
    const rows = buildConversation([
      item('e1', '2026-08-24T10:01:00Z', { kind: 'event', label: 'run.started' }),
      item('s1', '2026-08-24T10:00:00Z', { kind: 'step' }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['day', 'talk', 'talk']);
  });

  it('returns nothing for an empty page', () => {
    expect(buildConversation([])).toEqual([]);
  });

  it('does not mutate the caller’s array', () => {
    const page = [item('b', '2026-08-24T10:01:00Z'), item('a', '2026-08-24T10:00:00Z')];
    buildConversation(page);
    expect(page.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('looksLikeGoal', () => {
  it('accepts the /assign prefix at any length', () => {
    expect(looksLikeGoal('/assign x')).toBe(true);
  });

  it('rejects anything under the length floor, even an imperative', () => {
    expect(looksLikeGoal('fix the bug')).toBe(false);
  });

  it('accepts a long imperative sentence', () => {
    expect(looksLikeGoal('build the exporter for the weekly digest')).toBe(true);
    expect(looksLikeGoal('Investigate why the nightly run stalls')).toBe(true);
  });

  it('rejects a long sentence addressed to someone', () => {
    expect(looksLikeGoal('@ada build the exporter for the weekly digest')).toBe(false);
  });

  it('rejects a long sentence that does not open with an imperative verb', () => {
    expect(looksLikeGoal('the exporter for the weekly digest looks wrong to me')).toBe(false);
  });

  it('requires a whole word — "fixture" is not "fix"', () => {
    expect(looksLikeGoal('fixtures for the weekly digest are stale again')).toBe(false);
  });

  it('ignores surrounding whitespace', () => {
    expect(looksLikeGoal('   build the exporter for the weekly digest   ')).toBe(true);
  });
});

describe('goalText', () => {
  it('strips the /assign prefix and trims', () => {
    expect(goalText('  /assign  ship the digest  ')).toBe('ship the digest');
  });

  it('leaves a plain goal untouched', () => {
    expect(goalText(' ship the digest ')).toBe('ship the digest');
  });
});

describe('clusterStatus', () => {
  it('takes the newest labelled step', () => {
    expect(
      clusterStatus([
        step('s1', '2026-08-24T10:00:00Z', 'a', 'running'),
        step('s2', '2026-08-24T10:01:00Z', 'a', 'done'),
      ]),
    ).toBe('done');
  });

  it('falls back to created when nothing is labelled', () => {
    expect(clusterStatus([step('s1', '2026-08-24T10:00:00Z', 'a', '')])).toBe('created');
  });
});

describe('nextPromptBatch', () => {
  const q = (
    id: string,
    patch: Partial<QueuedPrompt> = {},
  ): QueuedPrompt => ({
    id,
    text: id,
    goal: false,
    phase: 'queued',
    ...patch,
  });

  it('has nothing to do on an empty outbox', () => {
    expect(nextPromptBatch([])).toBeNull();
  });

  it('refuses to start a second post while one is in flight', () => {
    expect(nextPromptBatch([q('a', { phase: 'sending' }), q('b')])).toBeNull();
  });

  it('folds a run of consecutive plain prompts into ONE body', () => {
    const batch = nextPromptBatch([q('a', { text: 'one' }), q('b', { text: 'two' })]);
    expect(batch).toEqual({ ids: ['a', 'b'], body: 'one\n\ntwo', goal: false });
  });

  it('never folds a goal — routing decomposes one goal, not two concatenated', () => {
    expect(nextPromptBatch([q('a', { goal: true }), q('b', { goal: true })])).toEqual({
      ids: ['a'],
      body: 'a',
      goal: true,
    });
  });

  it('stops a plain run at the first goal', () => {
    expect(nextPromptBatch([q('a'), q('b'), q('c', { goal: true })])).toMatchObject({
      ids: ['a', 'b'],
      goal: false,
    });
  });

  it('skips a failed row and keeps draining behind it', () => {
    expect(nextPromptBatch([q('a', { phase: 'failed' }), q('b')])).toMatchObject({ ids: ['b'] });
  });

  it('does not fold across a failed row — those two were never one body', () => {
    expect(
      nextPromptBatch([q('a'), q('b', { phase: 'failed' }), q('c')]),
    ).toMatchObject({ ids: ['a'] });
  });

  it('has nothing to do when every row has already failed', () => {
    expect(nextPromptBatch([q('a', { phase: 'failed' })])).toBeNull();
  });
});

describe('dayLabel', () => {
  const now = new Date('2026-08-25T12:00:00Z').getTime();
  const words = { today: 'Today', yesterday: 'Yesterday' };

  it('names today and yesterday', () => {
    expect(dayLabel('2026-08-25T09:00:00Z', words, now)).toBe('Today');
    expect(dayLabel('2026-08-24T09:00:00Z', words, now)).toBe('Yesterday');
  });

  it('formats anything older as a date', () => {
    expect(dayLabel('2026-08-01T09:00:00Z', words, now)).not.toBe('Today');
    expect(dayLabel('2026-08-01T09:00:00Z', words, now)).not.toBe('');
  });

  it('returns an empty label for an unparseable timestamp rather than "Invalid Date"', () => {
    expect(dayLabel('not-a-date', words, now)).toBe('');
  });
});

/* ----------------------------------------------------------------------------
 * ROW IDENTITY ACROSS A REBUILD.
 *
 * `buildConversation` is pure and allocates a fresh object per row, so one
 * arriving message handed every memoized card a brand-new `row` prop and a
 * brand-new `items` array. The virtualizer's `getItemKey` saved the DOM nodes;
 * nothing saved the renders. These assert identity by REFERENCE, because
 * reference is exactly what `React.memo` compares.
 * -------------------------------------------------------------------------- */
describe('reconcileRows', () => {
  const page = (ids: string[]) => ids.map((id, i) => item(id, `2026-08-20T10:0${i}:00Z`));

  it('returns the previous ARRAY when nothing changed', () => {
    const items = page(['a', 'b', 'c']);
    const first = buildConversation(items);
    const second = reconcileRows(first, buildConversation(items));
    expect(second).toBe(first);
  });

  it('keeps every unchanged row object when one message arrives', () => {
    const items = page(['a', 'b', 'c']);
    const first = buildConversation(items);
    // The channel is newest-first; a new message lands at the head.
    const grown = buildConversation([item('d', '2026-08-20T10:09:00Z'), ...items]);
    const next = reconcileRows(first, grown);

    expect(next).not.toBe(first);
    expect(next).toHaveLength(first.length + 1);
    // Every row the previous build already produced is the SAME object.
    for (const row of first) {
      expect(next.find((r) => r.key === row.key)).toBe(row);
    }
    expect(next[next.length - 1]!.key).toBe('talk:d');
  });

  it('keeps a cluster row AND its items array when the cluster did not change', () => {
    const steps = [
      step('s2', '2026-08-20T10:02:00Z', 'asg-1'),
      step('s1', '2026-08-20T10:01:00Z', 'asg-1'),
    ];
    const first = buildConversation(steps);
    const next = reconcileRows(first, buildConversation(steps));
    const a = first.find((r) => r.kind === 'assignment')!;
    const b = next.find((r) => r.kind === 'assignment')!;
    expect(b).toBe(a);
    // The array identity is the one AssignmentCard's memo compares.
    expect(b.kind === 'assignment' && a.kind === 'assignment' && b.items === a.items).toBe(true);
  });

  it('replaces a cluster row when a step joins it', () => {
    const base = [step('s1', '2026-08-20T10:01:00Z', 'asg-1')];
    const first = buildConversation(base);
    const grown = buildConversation([step('s2', '2026-08-20T10:02:00Z', 'asg-1'), ...base]);
    const next = reconcileRows(first, grown);
    const a = first.find((r) => r.kind === 'assignment')!;
    const b = next.find((r) => r.kind === 'assignment')!;
    expect(b).not.toBe(a);
    expect(b.kind === 'assignment' && b.items).toHaveLength(2);
  });

  it('replaces a talk row when the item object itself was replaced', () => {
    const first = buildConversation(page(['a']));
    const next = reconcileRows(first, buildConversation(page(['a'])));
    // Same id, DIFFERENT object — the slice only preserves identity on a quiet
    // refresh, so a genuine rewrite must not be mistaken for one.
    expect(next[next.length - 1]).not.toBe(first[first.length - 1]);
  });
});
