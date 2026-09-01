import { describe, expect, it } from 'vitest';
import {
  buildConversation,
  clusterStatus,
  dayLabel,
  goalText,
  looksLikeGoal,
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
