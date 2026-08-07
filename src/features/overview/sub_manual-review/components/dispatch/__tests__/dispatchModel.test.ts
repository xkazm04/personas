/**
 * The dispatch panel's whole answer is a merge of three sources that do not
 * agree by construction: the approved queue (`dev_ideas`, one page), the
 * undispatched signal (a different query with a different limit), and the
 * project rows that decide whether Fleet can run at all. What is pinned here
 * is that the merge never invents, never drops, and never softens a blocker.
 */
import { describe, it, expect } from 'vitest';

import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';
import type { AttentionThresholds } from '@/lib/bindings/AttentionThresholds';

import type { BacklogIdea } from '../../backlog/backlogModel';
import {
  buildDispatchRows,
  compareDispatch,
  dispatchGroupPath,
  fleetBlockedRows,
  fleetBlockFor,
  isStale,
  NO_PROJECT_SEGMENT,
  summarizeDispatch,
  type DispatchRow,
} from '../dispatchModel';

function idea(over: Partial<BacklogIdea> = {}): BacklogIdea {
  return {
    id: 'i1', title: 'Idea one', description: '', reasoning: '', category: 'technical',
    origin: null, scanType: 'scan', projectId: 'p1', projectName: 'Alpha',
    effort: 5, impact: 5, risk: 5, priority: null, status: 'accepted',
    evidence: null, verifyState: null, createdAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function signal(over: Partial<UndispatchedIdea> = {}): UndispatchedIdea {
  return {
    id: 'i1', title: 'Idea one', projectId: 'p1', projectName: 'Alpha',
    category: 'technical', origin: null, priority: null, impact: null, effort: null,
    acceptedAt: '2026-08-01T00:00:00Z', ageHours: 12,
    ...over,
  };
}

const thresholds: AttentionThresholds = {
  staleGoalDays: 7, ideaDispatchDays: 3, taskRunningHours: 4, taskQueuedHours: 24,
};

/** Alpha has a folder, Beta was never given one, Gamma is not in the store. */
const rootPathOf = (id: string) =>
  ({ p1: 'C:/repos/alpha', p2: '   ' } as Record<string, string>)[id] ?? null;

describe('fleetBlockFor — Fleet targets a directory, not a persona', () => {
  it('clears a project with a real root path', () => {
    expect(fleetBlockFor('p1', rootPathOf)).toBeNull();
  });

  it('blocks an idea that is not project-scoped at all', () => {
    expect(fleetBlockFor(null, rootPathOf)).toBe('no_project');
  });

  it('blocks a project the store cannot resolve — same situation for the backend', () => {
    expect(fleetBlockFor('gone', rootPathOf)).toBe('no_project');
  });

  it('treats a blank root path as no path, exactly like the Rust arm does', () => {
    // dev_tools.rs filters on `!r.trim().is_empty()`; whitespace is not a folder.
    expect(fleetBlockFor('p2', rootPathOf)).toBe('no_root_path');
  });
});

describe('buildDispatchRows — the merge', () => {
  it('marks an approved idea that carries the undispatched signal', () => {
    const rows = buildDispatchRows([idea()], [signal()], rootPathOf);
    expect(rows).toHaveLength(1);
    expect(rows[0].undispatched).toBe(true);
    // The age is the BACKEND's, not a re-derivation from the idea's created_at.
    expect(rows[0].acceptedAt).toBe('2026-08-01T00:00:00Z');
    expect(rows[0].ageHours).toBe(12);
  });

  it('leaves an approved idea with a task unflagged and ageless', () => {
    const rows = buildDispatchRows([idea()], [], rootPathOf);
    expect(rows[0].undispatched).toBe(false);
    // Not 0 — "waiting since" means nothing for something already sent.
    expect(rows[0].acceptedAt).toBeNull();
    expect(rows[0].ageHours).toBeNull();
  });

  it('still shows an undispatched idea the approved page never loaded', () => {
    // The two reads have different limits. Dropping the signal's own row
    // because the other list is short would hide the exact thing the panel
    // exists to surface.
    const rows = buildDispatchRows([], [signal({ id: 'i9', title: 'Forgotten' })], rootPathOf);
    expect(rows.map((r) => r.id)).toEqual(['i9']);
    expect(rows[0].title).toBe('Forgotten');
    expect(rows[0].undispatched).toBe(true);
  });

  it('never lists the same idea twice when both sources carry it', () => {
    const rows = buildDispatchRows([idea()], [signal()], rootPathOf);
    expect(rows.map((r) => r.id)).toEqual(['i1']);
  });

  it('carries the Fleet blocker onto every row, from either source', () => {
    const rows = buildDispatchRows(
      [idea({ id: 'a', projectId: 'p2', projectName: 'Beta' })],
      [signal({ id: 'b', projectId: null, projectName: null })],
      rootPathOf,
    );
    expect(rows.find((r) => r.id === 'a')?.fleetBlock).toBe('no_root_path');
    expect(rows.find((r) => r.id === 'b')?.fleetBlock).toBe('no_project');
  });

  it('tolerates a signal list that has not been read yet', () => {
    const rows = buildDispatchRows([idea()], null, rootPathOf);
    expect(rows[0].undispatched).toBe(false);
  });
});

describe('grouping is by project, because that is what a dispatch targets', () => {
  it('uses the project name as the rail path', () => {
    expect(dispatchGroupPath(buildDispatchRows([idea()], [], rootPathOf)[0])).toBe('Alpha');
  });

  it('gives project-less ideas their own bucket rather than the root', () => {
    const [row] = buildDispatchRows([idea({ projectId: null, projectName: '' })], [], rootPathOf);
    expect(dispatchGroupPath(row)).toBe(NO_PROJECT_SEGMENT);
  });
});

describe('staleness is the backend rule, echoed — never one of ours', () => {
  const row = (ageHours: number | null, undispatched = true): DispatchRow => ({
    id: 'x', title: 't', description: '', projectId: 'p1', projectName: 'Alpha',
    undispatched, acceptedAt: '2026-08-01T00:00:00Z', ageHours, fleetBlock: null,
  });

  it('applies the thresholds the queue says it used', () => {
    expect(isStale(row(3 * 24), thresholds)).toBe(true);
    expect(isStale(row(3 * 24 - 1), thresholds)).toBe(false);
  });

  it('says nothing when the thresholds were never read', () => {
    expect(isStale(row(9999), null)).toBe(false);
  });

  it('says nothing when the age itself is unknown', () => {
    // `ageHours: null` means the stamp would not parse — never treat it as 0
    // and never treat it as urgent.
    expect(isStale(row(null), thresholds)).toBe(false);
  });

  it('is not claimed about an idea that already has a task', () => {
    expect(isStale(row(9999, false), thresholds)).toBe(false);
  });
});

describe('summarizeDispatch — the header line', () => {
  it('counts total, never-dispatched and stale separately', () => {
    const rows = buildDispatchRows(
      [idea({ id: 'a' }), idea({ id: 'b' }), idea({ id: 'c' })],
      [signal({ id: 'a', ageHours: 200 }), signal({ id: 'b', ageHours: 2 })],
      rootPathOf,
    );
    expect(summarizeDispatch(rows, thresholds)).toEqual({ total: 3, undispatched: 2, stale: 1 });
  });

  it('reports zero stale rather than guessing when thresholds are absent', () => {
    const rows = buildDispatchRows([idea()], [signal({ ageHours: 9999 })], rootPathOf);
    expect(summarizeDispatch(rows, null).stale).toBe(0);
  });
});

describe('compareDispatch — worst first', () => {
  it('puts never-dispatched above already-sent, then oldest first', () => {
    const rows = buildDispatchRows(
      [idea({ id: 'sent', title: 'Sent' }), idea({ id: 'new' }), idea({ id: 'old' })],
      [signal({ id: 'new', ageHours: 5 }), signal({ id: 'old', ageHours: 500 })],
      rootPathOf,
    );
    expect([...rows].sort(compareDispatch).map((r) => r.id)).toEqual(['old', 'new', 'sent']);
  });

  it('does not let an unknown age outrank a measured one', () => {
    const rows = buildDispatchRows(
      [idea({ id: 'known' }), idea({ id: 'unknown' })],
      [signal({ id: 'known', ageHours: 1 }), signal({ id: 'unknown', ageHours: null })],
      rootPathOf,
    );
    expect([...rows].sort(compareDispatch).map((r) => r.id)).toEqual(['known', 'unknown']);
  });
});

describe('fleetBlockedRows — what to say before the click', () => {
  it('reports only the selected rows Fleet would refuse', () => {
    const rows = buildDispatchRows(
      [idea({ id: 'ok' }), idea({ id: 'bad', projectId: 'p2' }), idea({ id: 'unselected', projectId: null })],
      [],
      rootPathOf,
    );
    const blocked = fleetBlockedRows(rows, new Set(['ok', 'bad']));
    expect(blocked.map((r) => r.id)).toEqual(['bad']);
  });
});
