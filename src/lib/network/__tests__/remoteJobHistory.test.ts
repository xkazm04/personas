import { describe, it, expect } from 'vitest';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import {
  REMOTE_JOB_HISTORY_CAP,
  isTerminalRemoteJobStatus,
  replaceRemoteJobs,
  selectJobsForDirection,
  sortRemoteJobsNewestFirst,
  upsertRemoteJob,
} from '../remoteJobHistory';

function job(over: Partial<RemoteJob> & Pick<RemoteJob, 'id'>): RemoteJob {
  return {
    id: over.id,
    direction: 'outbound',
    peerId: 'peer-1',
    peerDisplayName: 'Laptop',
    kind: 'instruction',
    instruction: 'do a thing',
    status: 'running',
    summary: null,
    refusalReason: null,
    lastSeq: 0,
    createdAt: '2026-08-06T10:00:00Z',
    updatedAt: '2026-08-06T10:00:00Z',
    completedAt: null,
    ...over,
  };
}

describe('isTerminalRemoteJobStatus', () => {
  it('treats refused and cancelled as terminal alongside completed and failed', () => {
    expect(['completed', 'failed', 'refused', 'cancelled'].map((s) =>
      isTerminalRemoteJobStatus(s as RemoteJob['status']),
    )).toEqual([true, true, true, true]);
  });

  it('leaves pending and running open', () => {
    expect(isTerminalRemoteJobStatus('pending')).toBe(false);
    expect(isTerminalRemoteJobStatus('running')).toBe(false);
  });
});

describe('sortRemoteJobsNewestFirst', () => {
  it('orders by updatedAt descending', () => {
    const sorted = sortRemoteJobsNewestFirst([
      job({ id: 'old', updatedAt: '2026-08-06T09:00:00Z' }),
      job({ id: 'new', updatedAt: '2026-08-06T11:00:00Z' }),
      job({ id: 'mid', updatedAt: '2026-08-06T10:00:00Z' }),
    ]);
    expect(sorted.map((j) => j.id)).toEqual(['new', 'mid', 'old']);
  });

  it('orders correctly across differing UTC offsets, where a string compare would not', () => {
    // 09:30+02:00 is 07:30Z — genuinely OLDER than 08:00Z, but sorts as newer
    // under a lexicographic compare.
    const sorted = sortRemoteJobsNewestFirst([
      job({ id: 'offset', updatedAt: '2026-08-06T09:30:00+02:00' }),
      job({ id: 'utc', updatedAt: '2026-08-06T08:00:00Z' }),
    ]);
    expect(sorted.map((j) => j.id)).toEqual(['utc', 'offset']);
  });

  it('falls back to createdAt then id so the order is stable', () => {
    const sorted = sortRemoteJobsNewestFirst([
      job({ id: 'b', createdAt: '2026-08-06T09:00:00Z' }),
      job({ id: 'a', createdAt: '2026-08-06T09:00:00Z' }),
    ]);
    expect(sorted.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('sorts unparseable timestamps last instead of throwing', () => {
    const sorted = sortRemoteJobsNewestFirst([
      job({ id: 'broken', updatedAt: 'not-a-date' }),
      job({ id: 'fine', updatedAt: '2026-08-06T08:00:00Z' }),
    ]);
    expect(sorted.map((j) => j.id)).toEqual(['fine', 'broken']);
  });

  it('does not mutate the input', () => {
    const input = [job({ id: 'a', updatedAt: '2026-08-06T09:00:00Z' }), job({ id: 'b' })];
    sortRemoteJobsNewestFirst(input);
    expect(input.map((j) => j.id)).toEqual(['a', 'b']);
  });
});

describe('upsertRemoteJob', () => {
  it('replaces the row with the same id rather than duplicating it', () => {
    const before = [job({ id: 'j1', status: 'running' })];
    const after = upsertRemoteJob(before, job({ id: 'j1', status: 'completed', updatedAt: '2026-08-06T10:05:00Z' }));
    expect(after).toHaveLength(1);
    expect(after[0]?.status).toBe('completed');
  });

  it('adds a row it has never seen, newest first', () => {
    const after = upsertRemoteJob(
      [job({ id: 'old', updatedAt: '2026-08-06T09:00:00Z' })],
      job({ id: 'fresh', updatedAt: '2026-08-06T12:00:00Z' }),
    );
    expect(after.map((j) => j.id)).toEqual(['fresh', 'old']);
  });

  it('drops an out-of-order push that is older than the row already held', () => {
    // The exact failure Tauri's unordered delivery produces: a late `pending`
    // must not overwrite the `completed` that already landed.
    const held = [job({ id: 'j1', status: 'completed', updatedAt: '2026-08-06T10:05:00Z' })];
    const after = upsertRemoteJob(held, job({ id: 'j1', status: 'pending', updatedAt: '2026-08-06T10:00:00Z' }));
    expect(after).toBe(held);
    expect(after[0]?.status).toBe('completed');
  });

  it('accepts a same-second update, because a summary can land without the clock moving', () => {
    const held = [job({ id: 'j1', summary: null })];
    const after = upsertRemoteJob(held, job({ id: 'j1', summary: 'done' }));
    expect(after[0]?.summary).toBe('done');
  });

  it('returns the same reference for a redundant push, so a burst costs no re-render', () => {
    const row = job({ id: 'j1' });
    const held = [row];
    expect(upsertRemoteJob(held, row)).toBe(held);
  });

  it('caps the retained history', () => {
    const many = Array.from({ length: REMOTE_JOB_HISTORY_CAP }, (_, i) =>
      job({ id: `j${i}`, updatedAt: `2026-08-06T10:00:${String(i % 60).padStart(2, '0')}Z` }),
    );
    const after = upsertRemoteJob(many, job({ id: 'newest', updatedAt: '2026-08-07T00:00:00Z' }));
    expect(after).toHaveLength(REMOTE_JOB_HISTORY_CAP);
    expect(after[0]?.id).toBe('newest');
  });
});

describe('replaceRemoteJobs', () => {
  it('normalizes order and applies the cap', () => {
    const after = replaceRemoteJobs([
      job({ id: 'a', updatedAt: '2026-08-06T09:00:00Z' }),
      job({ id: 'b', updatedAt: '2026-08-06T11:00:00Z' }),
    ]);
    expect(after.map((j) => j.id)).toEqual(['b', 'a']);
  });
});

describe('selectJobsForDirection', () => {
  const jobs = [job({ id: 'out', direction: 'outbound' }), job({ id: 'in', direction: 'inbound' })];

  it('returns the same reference for the merged timeline', () => {
    expect(selectJobsForDirection(jobs, 'all')).toBe(jobs);
  });

  it('narrows to one side of the exchange', () => {
    expect(selectJobsForDirection(jobs, 'outbound').map((j) => j.id)).toEqual(['out']);
    expect(selectJobsForDirection(jobs, 'inbound').map((j) => j.id)).toEqual(['in']);
  });
});
