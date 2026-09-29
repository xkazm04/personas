import { describe, expect, it } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import {
  buildZones,
  columnOf,
  columnsForWidth,
  groupRuns,
  isLate,
  lateDays,
  moveZone,
  partitionColumns,
  PROJECT_NONE,
  railOf,
  stepZone,
} from '../questlog/questlogModel';

let seq = 0;
function note(status: NoteStatus, projectId: string | null, title = `goal ${seq}`): DevNote {
  seq += 1;
  return {
    id: `n${seq}`, projectId, milestoneId: null, title, bodyMd: '', status,
    orderIndex: seq, dispatchTarget: null, dispatchKey: null, fleetSessionId: null,
    agentId: null, resultJson: null, publishedAt: null, startedAt: null,
    completedAt: null, archivedAt: null, createdAt: '', updatedAt: '',
  };
}

const projects = [
  { id: 'p-zebra', name: 'zebra' },
  { id: 'p-apple', name: 'Apple' },
  { id: 'p-mango', name: 'mango' },
];

describe('railOf', () => {
  it('puts draft on neither rail, because both start there', () => {
    expect(railOf('draft')).toBe('shared');
  });

  it('separates the plan rail from the brainstorm rail', () => {
    expect(railOf('scoped')).toBe('plan');
    expect(railOf('cut')).toBe('plan');
    expect(railOf('shipped')).toBe('plan');
    expect(railOf('published')).toBe('brainstorm');
    expect(railOf('in_progress')).toBe('brainstorm');
    expect(railOf('completed')).toBe('brainstorm');
  });
});

describe('buildZones', () => {
  it('seats projects alphabetically, case-insensitively, with the unmapped bucket last', () => {
    const notes = [note('draft', 'p-zebra'), note('draft', 'p-apple'), note('draft', null), note('draft', 'p-mango')];
    const zones = buildZones(notes, projects, 'No project');
    expect(zones.map((z) => z.name)).toEqual(['Apple', 'mango', 'zebra', 'No project']);
    expect(zones[3]!.id).toBe(PROJECT_NONE);
    expect(zones[3]!.none).toBe(true);
  });

  it('drops a project with no goals rather than seating an empty zone', () => {
    const zones = buildZones([note('draft', 'p-mango')], projects, 'No project');
    expect(zones.map((z) => z.id)).toEqual(['p-mango']);
  });

  // THE POINT OF THE WHOLE LAYOUT: a seat is derived from the name and nothing
  // else, so it survives every change that is not a rename.
  it('keeps a seat when the goal counts change completely', () => {
    const few = buildZones([note('draft', 'p-zebra'), note('draft', 'p-apple')], projects, 'No project');
    const many = buildZones(
      [note('draft', 'p-apple'), ...Array.from({ length: 20 }, () => note('cut', 'p-zebra'))],
      projects,
      'No project',
    );
    expect(few.map((z) => z.id)).toEqual(many.map((z) => z.id));
  });

  it('orders a zone plan rail first, then draft, then brainstorm', () => {
    const notes = [
      note('completed', 'p-apple'), note('draft', 'p-apple'), note('cut', 'p-apple'), note('scoped', 'p-apple'),
    ];
    const zone = buildZones(notes, projects, 'No project')[0]!;
    expect(zone.goals.map((g) => g.status)).toEqual(['scoped', 'cut', 'draft', 'completed']);
  });
});

describe('groupRuns', () => {
  it('collapses consecutive goals of one status into a single run', () => {
    const runs = groupRuns([note('scoped', 'p'), note('scoped', 'p'), note('scoped', 'p'), note('cut', 'p')]);
    expect(runs.map((r) => r.goals.length)).toEqual([3, 1]);
    expect(runs.map((r) => r.status)).toEqual(['scoped', 'cut']);
  });

  it('marks the one boundary that matters — where the plan rail hands over', () => {
    const runs = groupRuns([note('cut', 'p'), note('draft', 'p'), note('completed', 'p')]);
    expect(runs.map((r) => r.breakBefore)).toEqual([false, true, false]);
  });

  it('never breaks before the first run', () => {
    expect(groupRuns([note('completed', 'p')])[0]!.breakBefore).toBe(false);
  });
});

describe('partitionColumns', () => {
  it('keeps the reading order — groups are consecutive and cover everything', () => {
    const { groups } = partitionColumns([10, 90, 10, 10, 90, 10], 3);
    expect(groups[0]![0]).toBe(0);
    expect(groups[groups.length - 1]![1]).toBe(6);
    for (let i = 1; i < groups.length; i += 1) expect(groups[i]![0]).toBe(groups[i - 1]![1]);
  });

  it('minimises the tallest column rather than splitting evenly by count', () => {
    // An even 3-way split would put [100] [1,1] [1,1] with a tallest of 100;
    // the optimum is the same, and any split that beats it does not exist.
    const { tallest } = partitionColumns([100, 1, 1, 1, 1], 3);
    expect(tallest).toBe(100);
    // Here the count-even split ([50,50] [50,50] [1,1]) is 100, the optimum 51.
    expect(partitionColumns([50, 50, 50, 50, 1, 1], 3).tallest).toBe(100);
    expect(partitionColumns([10, 10, 10, 10, 10, 10], 3).tallest).toBe(20);
  });

  it('survives an empty desk and a single zone', () => {
    expect(partitionColumns([], 3)).toEqual({ groups: [], tallest: 0 });
    expect(partitionColumns([42], 3).groups).toEqual([[0, 1]]);
  });
});

describe('columnsForWidth', () => {
  it('never drops to one column — a single column is the list this layout replaces', () => {
    expect(columnsForWidth(200)).toBe(2);
    expect(columnsForWidth(0)).toBe(2);
    expect(columnsForWidth(Number.NaN)).toBe(2);
  });

  it('adds a column per ~390px and caps at five', () => {
    expect(columnsForWidth(1280)).toBe(3);
    expect(columnsForWidth(1920)).toBe(4);
    expect(columnsForWidth(9000)).toBe(5);
  });
});

describe('moveZone', () => {
  // [0,2) [2,5) [5,6)
  const groups: [number, number][] = [[0, 2], [2, 5], [5, 6]];

  it('walks the column and stops at its ends rather than wrapping', () => {
    expect(moveZone(groups, 2, 0, 1)).toBe(3);
    expect(moveZone(groups, 4, 0, 1)).toBeNull();
    expect(moveZone(groups, 2, 0, -1)).toBeNull();
  });

  it('steps to the neighbouring column at the same relative depth', () => {
    expect(columnOf(groups, 3)).toBe(1);
    expect(moveZone(groups, 0, 1, 0)).toBe(2);
    expect(moveZone(groups, 4, 1, 0)).toBe(5);
    expect(moveZone(groups, 5, 1, 0)).toBeNull();
    expect(moveZone(groups, 0, -1, 0)).toBeNull();
  });

  it('refuses a move on an empty desk', () => {
    expect(moveZone([], 0, 0, 1)).toBeNull();
  });
});

describe('stepZone', () => {
  const ids = ['a', 'b', 'c'];

  it('wraps, because the alphabet is a ring and not a stack', () => {
    expect(stepZone(ids, 'c', 1)).toBe('a');
    expect(stepZone(ids, 'a', -1)).toBe('c');
  });

  it('starts at either end when nothing is current', () => {
    expect(stepZone(ids, null, 1)).toBe('a');
    expect(stepZone(ids, null, -1)).toBe('c');
    expect(stepZone([], null, 1)).toBeNull();
  });
});

describe('isLate / lateDays', () => {
  const now = new Date('2026-09-22T12:00:00Z');

  it('is never late without a target date — absence is unscheduled, not overdue', () => {
    expect(isLate(null, 'scoped', now)).toBe(false);
    expect(isLate(undefined, 'scoped', now)).toBe(false);
  });

  it('does not call finished work late', () => {
    expect(isLate('2026-01-01', 'shipped', now)).toBe(false);
    expect(isLate('2026-01-01', 'completed', now)).toBe(false);
    expect(isLate('2026-01-01', 'cut', now)).toBe(true);
  });

  it('gives the target day its whole span before calling it late', () => {
    expect(isLate('2026-09-22', 'cut', now)).toBe(false);
    expect(isLate('2026-09-21', 'cut', now)).toBe(true);
  });

  it('never renders a zero-day lateness', () => {
    expect(lateDays('2026-09-22', now)).toBe(1);
    expect(lateDays('2026-09-12', now)).toBe(10);
  });
});
