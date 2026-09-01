import { describe, it, expect } from 'vitest';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { TaggedItem } from '../../../channels/types';
import { channelRowsByProject, ideaToRow, triageToRow } from '../railModel';
import { railRowHeight, RAIL_ROW_HEIGHT, RAIL_GROUP_HEADER_HEIGHT } from '../RailRowView';

/**
 * Grouping the Messages tab is easy to get almost right. The two things worth
 * pinning are the ORDER (projects by their own newest message, not alphabetical
 * and not by whatever order the team list happened to be in) and the fact that
 * exactly ONE row per project carries a header — a second header mid-run, or a
 * header on a continuation row, both misplace every row beneath them, because
 * the virtualizer measures from the same flag.
 */

function item(over: Partial<TeamChannelItem>): TeamChannelItem {
  return {
    id: 'x', kind: 'persona', at: '2026-09-01T00:00:00Z', personaId: null,
    label: 'said', body: 'hello', assignmentId: null, stepId: null, extra: null,
    replyTo: null, deliberationId: null, importance: null, consumers: null,
    ...over,
  } as TeamChannelItem;
}

function tagged(teamId: string, teamName: string, id: string, at: string): TaggedItem {
  return {
    item: item({ id, at }),
    team: { teamId, teamName, teamColor: '#888', members: [] },
  };
}

const noPersona = () => undefined;
const neverSeen = () => null;

describe('channelRowsByProject', () => {
  // Newest-first, interleaved across three projects — which is exactly what the
  // merged feed hands over and exactly what is unreadable in one column.
  const merged = [
    tagged('t-b', 'Beta', 'b1', '2026-09-01T10:00:00Z'),
    tagged('t-a', 'Alpha', 'a1', '2026-09-01T09:00:00Z'),
    tagged('t-b', 'Beta', 'b2', '2026-09-01T08:00:00Z'),
    tagged('t-c', 'Gamma', 'c1', '2026-09-01T07:00:00Z'),
    tagged('t-a', 'Alpha', 'a2', '2026-09-01T06:00:00Z'),
  ];

  it('keeps every row — grouping reorders, it never drops', () => {
    const rows = channelRowsByProject(merged, noPersona, neverSeen);
    expect(rows).toHaveLength(merged.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(merged.length);
  });

  it('orders projects by their own newest message, not alphabetically', () => {
    // Beta spoke most recently, so Beta leads — even though Alpha sorts first
    // and would win any stable name order. Live activity stays at the top.
    const rows = channelRowsByProject(merged, noPersona, neverSeen);
    expect(rows.map((r) => r.groupHeader).filter(Boolean)).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('keeps each project newest-first within its own run', () => {
    const rows = channelRowsByProject(merged, noPersona, neverSeen);
    expect(rows.map((r) => r.id)).toEqual([
      't-b:b1', 't-b:b2', 't-a:a1', 't-a:a2', 't-c:c1',
    ]);
  });

  it('puts the header on the FIRST row of a run and on no other', () => {
    const rows = channelRowsByProject(merged, noPersona, neverSeen);
    // Row 2 is Beta's second message; a header there would draw the project
    // name twice and add its height to a row that must not have it.
    expect(rows[0]!.groupHeader).toBe('Beta');
    expect(rows[1]!.groupHeader).toBeNull();
    expect(rows.filter((r) => r.groupHeader !== null)).toHaveLength(3);
  });

  it('returns an empty list for an empty feed rather than a stray header', () => {
    expect(channelRowsByProject([], noPersona, neverSeen)).toEqual([]);
  });
});

describe('railRowHeight — the one height authority', () => {
  const [first, second] = channelRowsByProject(
    [tagged('t-a', 'Alpha', 'a1', '2026-09-01T09:00:00Z'),
     tagged('t-a', 'Alpha', 'a2', '2026-09-01T08:00:00Z')],
    noPersona, neverSeen,
  );

  it('adds the band only to the row that draws one', () => {
    expect(railRowHeight(first!)).toBe(RAIL_ROW_HEIGHT + RAIL_GROUP_HEADER_HEIGHT);
    expect(railRowHeight(second!)).toBe(RAIL_ROW_HEIGHT);
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

describe('a channel row', () => {
  const [row] = channelRowsByProject(
    [tagged('t-a', 'Alpha', 'a1', '2026-09-01T09:00:00Z')], noPersona, neverSeen,
  );

  it('prints its time and participates in read tracking', () => {
    expect(row!.showTime).toBe(true);
    expect(row!.tracksRead).toBe(true);
  });

  it('is unread when the team has never been looked at', () => {
    expect(row!.unread).toBe(true);
  });

  it('does not repeat the project in its meta line — the band above says it', () => {
    expect(row!.source ?? '').not.toContain('Alpha');
  });
});
