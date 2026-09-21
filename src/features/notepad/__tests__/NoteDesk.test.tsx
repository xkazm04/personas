// The desk's two filters and what a LINKED card shows.
//
// Both are readings that look fine when they are wrong: a lens that admits the
// wrong statuses still renders cards, and a card missing its plan chrome still
// renders a card. So these pin the discriminations rather than the pixels —
// which notes each lens admits, that `shipped` is admitted by NONE of them, that
// the choice survives a remount, and that the goals bar appears exactly when
// there is a fraction to draw.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import { NoteDeskCard } from '../overview/NoteDeskCard';
import { NoteOverview } from '../overview/NoteOverview';

// The picker opens a Listbox over the workspace's projects and the quick-write
// surface is a contentEditable with its own input rules. Neither is what this
// file is about; both have their own homes.
vi.mock('../overview/parts/NoteProjectPicker', () => ({
  NoteProjectPicker: ({ note }: { note: DevNote }) => (
    <div data-testid={`picker-${note.id}`}>{note.projectId ?? 'none'}</div>
  ),
}));
vi.mock('../overview/parts/NoteQuickWrite', () => ({
  NoteQuickWrite: ({ note }: { note: DevNote }) => <div data-testid={`quick-${note.id}`} />,
}));

let summaries: Record<string, NotePlanSummary> = {};
let stale = false;
vi.mock('../useNotepad', () => ({
  // The grid's presence map reads every note by id; an empty map is "nobody working".
  useNotepadNotes: () => ({}),
  useNotepadPlanSummaries: () => summaries,
  useNotepadStatus: () => ({ loading: false, loaded: true, planSummariesStale: stale }),
}));

const note = (id: string, over: Partial<DevNote> = {}): DevNote =>
  ({
    id,
    projectId: 'p1',
    milestoneId: null,
    title: `Note ${id}`,
    bodyMd: 'body',
    status: 'draft' as NoteStatus,
    orderIndex: 0,
    dispatchTarget: null,
    dispatchKey: null,
    fleetSessionId: null,
    agentId: null,
    resultJson: null,
    publishedAt: null,
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
    ...over,
  }) as DevNote;

const summary = (noteId: string, over: Partial<NotePlanSummary> = {}): NotePlanSummary => ({
  noteId,
  milestoneId: `ms-${noteId}`,
  milestoneStatus: 'active',
  goal: 'Ship the dock',
  targetDate: null,
  cutAt: '2026-09-01T00:00:00.000Z',
  shippedAt: null,
  goalsTotal: 4,
  goalsDone: 1,
  ...over,
});

const projects: DevProject[] = [
  { id: 'p1', name: 'personas', root_path: '/a' } as DevProject,
  { id: 'p2', name: 'athena', root_path: '/b' } as DevProject,
];

function desk(notes: DevNote[], over: { initialProjectId?: string | null } = {}) {
  const onOpen = vi.fn();
  render(
    <NoteOverview
      loading={false}
      notes={notes}
      projects={projects}
      saveStates={{}}
      atCap={false}
      focusNoteId={null}
      onOpen={onOpen}
      onPatch={vi.fn()}
      onCreate={vi.fn()}
      onDelete={vi.fn()}
      onCertify={vi.fn()}
      {...over}
    />,
  );
  return { onOpen };
}

const visibleIds = (all: DevNote[]) =>
  all.filter((n) => screen.queryByTestId(`notepad-card-${n.id}`)).map((n) => n.id);

const reveal = { hasEntered: () => true, markEntered: vi.fn() };

beforeEach(() => {
  summaries = {};
  stale = false;
  localStorage.clear();
  // The grid animates leavers OUT (AnimatePresence), so a filtered-away card is
  // still in the DOM for its exit. Under the app's own Reduce Motion the exit
  // is instant — it still lands a frame later, hence the `waitFor`s below.
  document.documentElement.setAttribute('data-motion', 'reduce');
});

describe('NoteOverview — the status lens', () => {
  const all = [
    note('draft', { status: 'draft' }),
    note('published', { status: 'published' }),
    note('done', { status: 'completed' }),
    note('scoped', { status: 'scoped', milestoneId: 'ms-1' }),
    note('cut', { status: 'cut', milestoneId: 'ms-2' }),
    note('shipped', { status: 'shipped', milestoneId: 'ms-3' }),
  ];

  it('opens on All, which is every rail EXCEPT shipped', () => {
    desk(all);
    expect(visibleIds(all)).toEqual(['draft', 'published', 'done', 'scoped', 'cut']);
  });

  it('Drafts is the brainstorm rail, Scoped is the plan rail mid-flight', async () => {
    desk(all);

    fireEvent.click(screen.getByRole('tab', { name: 'Drafts' }));
    await waitFor(() => expect(visibleIds(all)).toEqual(['draft', 'published', 'done']));

    fireEvent.click(screen.getByRole('tab', { name: 'Scoped' }));
    await waitFor(() => expect(visibleIds(all)).toEqual(['scoped', 'cut']));
  });

  // A shipped note lives in the archive drawer's Shipped group. If it leaked
  // onto the desk it would also be counted by the project tabs, and the desk
  // would fill up with records.
  it('never shows a shipped note, under any lens', () => {
    desk(all);
    for (const label of ['Drafts', 'Scoped']) {
      fireEvent.click(screen.getByRole('tab', { name: label }));
      expect(screen.queryByTestId('notepad-card-shipped')).toBeNull();
    }
  });

  // Per-viewer convenience, in browser storage, read at MOUNT — the desk opens
  // on the lens it closed on. Nothing downstream depends on it, which is why it
  // is allowed to live there at all.
  it('remembers the lens across a remount', () => {
    desk(all);
    fireEvent.click(screen.getByRole('tab', { name: 'Scoped' }));
    expect(localStorage.getItem('personas.notepad.deskFilter')).toBe('scoped');

    cleanup();
    desk(all);
    expect(screen.getByRole('tab', { name: 'Scoped' })).toHaveAttribute('aria-selected', 'true');
    expect(visibleIds(all)).toEqual(['scoped', 'cut']);
  });
});

describe('NoteOverview — initialProjectId', () => {
  const all = [note('a', { projectId: 'p1' }), note('b', { projectId: 'p2' })];

  it('seeds the project filter so a deep link opens already narrowed', () => {
    desk(all, { initialProjectId: 'p2' });
    expect(visibleIds(all)).toEqual(['b']);
  });

  // A SEED, not a controlled value: once the pad is open the operator owns the
  // filter, and a prop that kept re-asserting itself would undo every click.
  it('does not fight the operator once they pick another project', async () => {
    desk(all, { initialProjectId: 'p2' });
    fireEvent.click(screen.getByRole('tab', { name: /personas/ }));
    await waitFor(() => expect(visibleIds(all)).toEqual(['a']));
  });

  it('falls back to All when the prop is absent', () => {
    desk(all);
    expect(visibleIds(all)).toEqual(['a', 'b']);
  });
});

describe('NoteDeskCard — the linked readings', () => {
  function card(row: DevNote, sum?: NotePlanSummary) {
    render(
      <NoteDeskCard
        note={row}
        projects={projects}
        saveState="clean"
        summary={sum}
        order={0}
        reveal={reveal}
        autoFocus={false}
        onOpen={vi.fn()}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
        onCertify={vi.fn()}
      />,
    );
  }

  it('a linked card draws the goals bar and the milestone stamp', () => {
    const row = note('brief', { status: 'cut', milestoneId: 'ms-1' });
    card(row, summary('brief'));

    const bar = screen.getByTestId('notepad-card-goals-brief');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '4');

    // The stamp REPLACES the plain status glyph rather than sitting beside it —
    // one "Cut" badge in the row, icon only, its word in the accessible name.
    const stamp = screen.getByTestId('notepad-card-stamp-brief');
    expect(stamp).toHaveAttribute('aria-label', 'Cut');
    expect(stamp).toHaveTextContent('');
    expect(screen.getAllByRole('img', { name: 'Cut' })).toHaveLength(1);
  });

  it('an unlinked card has no bar and no stamp', () => {
    card(note('plain'));
    expect(screen.queryByTestId('notepad-card-goals-plain')).toBeNull();
    expect(screen.queryByTestId('notepad-card-stamp-plain')).toBeNull();
  });

  // Zero goals is not zero PROGRESS: a milestone nobody has decomposed has
  // nothing to be a fraction of, and an empty rule reads as "stalled".
  it('hides the bar when the milestone has no goals yet', () => {
    const row = note('fresh', { status: 'scoped', milestoneId: 'ms-9' });
    card(row, summary('fresh', { goalsTotal: 0, goalsDone: 0, cutAt: null }));
    expect(screen.queryByTestId('notepad-card-goals-fresh')).toBeNull();
    // No stamp either — `scoped` has no stamp anywhere, so the ordinary status
    // badge is what shows.
    expect(screen.queryByTestId('notepad-card-stamp-fresh')).toBeNull();
    expect(screen.getByRole('img', { name: 'Scoped' })).toBeInTheDocument();
  });
});

describe('the desk forecast', () => {
  // Two observed cycles in the project is the evidence bar (`MIN_SAMPLES`).
  const withHistory = [
    note('s1', { status: 'shipped', milestoneId: 'm1' }),
    note('s2', { status: 'shipped', milestoneId: 'm2' }),
    note('live', { status: 'cut', milestoneId: 'm3' }),
  ];
  const historySummaries = {
    s1: summary('s1', { milestoneStatus: 'shipped', cutAt: '2026-01-01T00:00:00.000Z', shippedAt: '2026-01-05T00:00:00.000Z' }),
    s2: summary('s2', { milestoneStatus: 'shipped', cutAt: '2026-02-01T00:00:00.000Z', shippedAt: '2026-02-05T00:00:00.000Z' }),
    live: summary('live', { milestoneStatus: 'active', cutAt: '2026-03-01T00:00:00.000Z' }),
  };

  it('appears on a cut card once the project has enough observed cycles', () => {
    summaries = historySummaries;
    desk(withHistory);
    // Four-day median from 2026-03-01.
    expect(screen.getByTestId('notepad-card-forecast-live')).toHaveTextContent('2026-03-05');
  });

  it('is absent below the evidence bar — one cycle is an anecdote', () => {
    summaries = { s1: historySummaries.s1, live: historySummaries.live };
    desk([withHistory[0]!, withHistory[2]!]);
    expect(screen.queryByTestId('notepad-card-forecast-live')).toBeNull();
  });

  // A stale map is the LAST GOOD reading, not the current one. A median built
  // on it is a guess on a guess, and "unknown" is the honest rendering.
  it('is suppressed entirely while the plan join is stale', () => {
    summaries = historySummaries;
    stale = true;
    desk(withHistory);
    expect(screen.queryByTestId('notepad-card-forecast-live')).toBeNull();
  });
});
