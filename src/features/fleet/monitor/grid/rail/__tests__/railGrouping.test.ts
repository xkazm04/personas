import { describe, it, expect } from 'vitest';
import { ideaToRow, triageToRow } from '../railModel';
import { railRowHeight, RAIL_ROW_HEIGHT, RAIL_GROUP_HEADER_HEIGHT } from '../RailRowView';

/**
 * The row model's backlog tabs and the height authority. The Messages tab's
 * thread grouping is pinned in `messageThreads.test.ts`.
 */

describe('railRowHeight — the one height authority', () => {
  const base = ideaToRow(
    {
      id: 'i1', title: 'T', projectId: 'p', projectName: 'Ledger', category: null,
      origin: null, priority: null, impact: null, effort: null,
      acceptedAt: '2026-09-01T00:00:00Z', ageHours: 4,
    } as never,
    'Dispatch',
  );

  it('adds the band only to a row that draws one', () => {
    expect(railRowHeight({ ...base, groupHeader: 'Alpha' })).toBe(RAIL_ROW_HEIGHT + RAIL_GROUP_HEADER_HEIGHT);
    expect(railRowHeight(base)).toBe(RAIL_ROW_HEIGHT);
  });
});

describe('the two backlog tabs are backlogs, not chronologies', () => {
  it('a review prints no time and no kind word', () => {
    // The kind is already the icon on line 1 (`KIND_META[kind].icon`), and the
    // instant changes no decision in a queue worked from the top.
    const row = triageToRow(
      {
        id: 'r1', sourceId: 's1', kind: 'review', title: 'T', body: '', tags: [], facts: [],
        source: { label: 'Ledger' }, createdAt: '2026-09-01T00:00:00Z', weight: 1,
        branches: [], verdictLabels: { accept: 'a', reject: 'r', skip: 's' },
      } as never,
      'Review',
    );
    expect(row.showTime).toBe(false);
    expect(row.showKind).toBe(false);
    // Still carried, for the screen reader and the modal.
    expect(row.kind).toBe('Review');
  });

  it('a dispatchable idea prints no time', () => {
    const row = ideaToRow(
      {
        id: 'i1', title: 'T', projectId: 'p', projectName: 'Ledger', category: null,
        origin: null, priority: null, impact: null, effort: null,
        acceptedAt: '2026-09-01T00:00:00Z', ageHours: 4,
      } as never,
      'Dispatch',
    );
    expect(row.showTime).toBe(false);
  });

  it('neither tracks reads, so neither is ever dimmed for being "read"', () => {
    const review = triageToRow(
      {
        id: 'r1', sourceId: 's1', kind: 'review', title: 'T', body: '', tags: [], facts: [],
        source: { label: 'Ledger' }, createdAt: '2026-09-01T00:00:00Z', weight: 1,
        branches: [], verdictLabels: { accept: 'a', reject: 'r', skip: 's' },
      } as never,
      'Review',
    );
    expect(review.tracksRead).toBe(false);
  });
});
