// The desk card's LIVE layer — the parts a screenshot cannot check:
//   - the right-click menu offers exactly the moves the dispatch bar would, and
//     refuses Delete while a Fleet session still holds the note;
//   - a new thread entry springs out as a bubble, leaves after 10 s, and holds
//     still while the pointer is over it;
//   - opening the thread popover marks the thread read.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';
import type { Translations } from '@/i18n/generated/types';
import { useSystemStore } from '@/stores/systemStore';

const api = vi.hoisted(() => ({
  listNoteComments: vi.fn(async () => [] as NoteComment[]),
  noteUnreadCounts: vi.fn(async () => []),
  markNoteCommentsRead: vi.fn(async () => undefined),
}));
vi.mock('@/api/notepad', async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

vi.mock('../parts/NoteProjectPicker', () => ({
  NoteProjectPicker: ({ note }: { note: DevNote }) => <div data-testid={`picker-${note.id}`} />,
}));
vi.mock('../parts/NoteQuickWrite', () => ({
  NoteQuickWrite: ({ note }: { note: DevNote }) => <div data-testid={`quick-${note.id}`} />,
}));

import { __resetNoteThreadStoreForTests, ingestNoteComment, unreadCountOf } from '../../thread/noteThreadStore';
import { __resetCardVisibilityForTests, isNoteCardVisible } from '../../thread/cardVisibility';
import { NoteDeskCard } from '../NoteDeskCard';
import { noteCardMenuItems, type NoteCardMenuHandlers } from '../parts/NoteCardMenu';
import { railNextStep } from '../parts/NoteLifecycleRail';

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

let seq = 0;
const comment = (over: Partial<NoteComment> = {}): NoteComment => {
  seq += 1;
  return {
    id: `c${seq}`,
    noteId: 'n1',
    authorKind: 'athena',
    authorName: null,
    kind: 'comment',
    bodyMd: 'Looks good — one question about the scope.',
    refKind: null,
    refId: null,
    verdict: null,
    createdAt: '2026-09-21T10:00:00Z',
    readAt: null,
    ...over,
  };
};

const session = (name: string, state: FleetSession['state']): FleetSession =>
  ({ id: `s-${name}`, name, state, createdAtMs: 1 }) as unknown as FleetSession;

const projects: DevProject[] = [{ id: 'p1', name: 'personas', root_path: '/a' } as DevProject];
const reveal = { hasEntered: () => true, markEntered: vi.fn() };

function card(row: DevNote, over: { onDelete?: () => void } = {}) {
  const onDelete = over.onDelete ?? vi.fn();
  render(
    <NoteDeskCard
      note={row}
      projects={projects}
      saveState="clean"
      order={0}
      reveal={reveal}
      autoFocus={false}
      onOpen={vi.fn()}
      onPatch={vi.fn()}
      onDelete={onDelete}
      onCertify={vi.fn()}
    />,
  );
  return { onDelete };
}

function strings(): Translations {
  let t: Translations | undefined;
  function Probe() {
    t = useTranslation().t;
    return null;
  }
  render(<Probe />);
  cleanup();
  return t!;
}

const handlers = (): NoteCardMenuHandlers => ({
  onOpen: vi.fn(),
  onAsk: vi.fn(),
  onPublish: vi.fn(),
  onToGoals: vi.fn(),
  onArchive: vi.fn(),
  onDelete: vi.fn(),
});

beforeEach(() => {
  __resetNoteThreadStoreForTests();
  __resetCardVisibilityForTests();
  useSystemStore.setState({ fleetSessions: [] });
  document.documentElement.setAttribute('data-motion', 'reduce');
  api.markNoteCommentsRead.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the card menu — the dispatch bar’s predicates, per status', () => {
  const byId = (items: ReturnType<typeof noteCardMenuItems>) => Object.fromEntries(items.map((i) => [i.id, i]));

  it('a draft with a project can be published, turned into goals and asked about', () => {
    const t = strings();
    const items = byId(noteCardMenuItems(note('n1'), [], t, handlers()));
    expect(items.publish!.disabled).toBe(false);
    expect(items.goals!.disabled).toBe(false);
    expect(items.ask!.disabled).toBe(false);
    expect(items.delete!.disabled).toBe(false);
  });

  it('a published note cannot be dispatched again, nor asked about (it belongs to a run)', () => {
    const t = strings();
    const items = byId(noteCardMenuItems(note('n1', { status: 'published' }), [], t, handlers()));
    expect(items.publish!.disabled).toBe(true);
    expect(items.goals!.disabled).toBe(true);
    expect(items.ask!.disabled).toBe(true);
    expect(items.ask!.hint).toBe(t.notepad.dispatch_needs_draft);
  });

  it('a note with no project names that as the reason', () => {
    const t = strings();
    const items = byId(noteCardMenuItems(note('n1', { projectId: null }), [], t, handlers()));
    expect(items.publish!.hint).toBe(t.notepad.dispatch_needs_project);
    expect(items.ask!.hint).toBe(t.notepad.dispatch_needs_project);
  });

  it('Delete is offered on every status — and refused while a Fleet session holds the note', () => {
    const t = strings();
    for (const status of ['draft', 'published', 'in_progress', 'completed', 'scoped', 'cut'] as NoteStatus[]) {
      expect(byId(noteCardMenuItems(note('abcdef12-0000', { status }), [], t, handlers())).delete!.disabled).toBe(false);
    }
    const running = [session('note:abcdef12', 'running')];
    const del = byId(noteCardMenuItems(note('abcdef12-0000', { status: 'in_progress' }), running, t, handlers())).delete!;
    expect(del.disabled).toBe(true);
    expect(del.hint).toBe(t.notepad.menu_delete_blocked_running);
    // A queued run still holds it; a finished one does not.
    expect(byId(noteCardMenuItems(note('abcdef12-0000'), [session('note:abcdef12', 'queued')], t, handlers())).delete!.disabled).toBe(true);
    expect(byId(noteCardMenuItems(note('abcdef12-0000'), [session('note:abcdef12', 'finished')], t, handlers())).delete!.disabled).toBe(false);
  });

  it('right-click opens the menu and Delete routes to the host (never deletes itself)', () => {
    const { onDelete } = card(note('n1', { status: 'completed' }));
    fireEvent.contextMenu(screen.getByTestId('notepad-card-n1'), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByTestId('notepad-card-menu-delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('the menu shows Delete disabled while the note runs', () => {
    useSystemStore.setState({ fleetSessions: [session('note:abcdef12', 'running')] });
    const { onDelete } = card(note('abcdef12-0000', { status: 'in_progress' }));
    fireEvent.contextMenu(screen.getByTestId('notepad-card-abcdef12-0000'), { clientX: 40, clientY: 40 });
    const del = screen.getByTestId('notepad-card-menu-delete');
    expect(del).toBeDisabled();
    fireEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('the lifecycle rail — the one step it offers', () => {
  it('draft → published on the brainstorm rail, draft → scoped once linked', () => {
    expect(railNextStep(note('n', {}))).toMatchObject({ status: 'published', action: 'publish', blockedKey: null });
    expect(railNextStep(note('n', { milestoneId: 'm' }))).toMatchObject({ status: 'scoped', action: 'goals' });
    expect(railNextStep(note('n', { projectId: null }))?.blockedKey).toBe('dispatch_needs_project');
  });

  it('cut and ship go through certify; the sweeper’s moves are never offered', () => {
    expect(railNextStep(note('n', { status: 'scoped', milestoneId: 'm' }))).toMatchObject({ status: 'cut', action: 'certify' });
    expect(railNextStep(note('n', { status: 'cut', milestoneId: 'm' }))).toMatchObject({ status: 'shipped', action: 'certify' });
    for (const status of ['published', 'in_progress', 'completed', 'shipped'] as NoteStatus[]) {
      expect(railNextStep(note('n', { status }))).toBeNull();
    }
  });
});

describe('the card bubble', () => {
  it('a mounted card is the visibility test the feeder routes on', () => {
    card(note('n1'));
    expect(isNoteCardVisible('n1')).toBe(true);
    cleanup();
    expect(isNoteCardVisible('n1')).toBe(false);
  });

  it('appears for an incoming entry and leaves after 10 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    card(note('n1'));
    act(() => ingestNoteComment(comment()));
    expect(screen.getByTestId('notepad-card-bubble-n1')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(9_000));
    expect(screen.getByTestId('notepad-card-bubble-n1')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_100));
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByTestId('notepad-card-bubble-n1')).toBeNull());
    // Timing out is not reading: the unread icon keeps it.
    expect(unreadCountOf('n1')).toBe(1);
    expect(api.markNoteCommentsRead).not.toHaveBeenCalled();
  });

  it('holds still while hovered, and resumes on leave', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    card(note('n1'));
    act(() => ingestNoteComment(comment()));
    const bubble = screen.getByTestId('notepad-card-bubble-n1');

    act(() => vi.advanceTimersByTime(4_000));
    fireEvent.mouseEnter(bubble);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId('notepad-card-bubble-n1')).toHaveAttribute('data-paused', 'true');

    fireEvent.mouseLeave(bubble);
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByTestId('notepad-card-bubble-n1')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_500));
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByTestId('notepad-card-bubble-n1')).toBeNull());
  });

  it('a newer entry replaces the bubble — one per card', async () => {
    card(note('n1'));
    act(() => ingestNoteComment(comment({ bodyMd: 'first' })));
    act(() => ingestNoteComment(comment({ bodyMd: 'second' })));
    // The old bubble crossfades out (AnimatePresence) as the new one springs in.
    await waitFor(() => expect(screen.getAllByTestId('notepad-card-bubble-n1')).toHaveLength(1));
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('a pending review offers Approve / Reject; a run reject asks for the reason first', () => {
    card(note('n1', { status: 'completed' }));
    act(() => ingestNoteComment(comment({ kind: 'review', authorKind: 'agent', refKind: 'run', refId: 'r1', verdict: 'pending' })));
    expect(screen.getByTestId('notepad-card-bubble-review-approve')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('notepad-card-bubble-review-reject'));
    expect(screen.getByTestId('notepad-card-bubble-review-reason')).toBeInTheDocument();
  });
});

describe('the thread popover', () => {
  it('opening it marks the thread read', async () => {
    card(note('n1'));
    act(() => ingestNoteComment(comment()));
    expect(unreadCountOf('n1')).toBe(1);

    fireEvent.click(screen.getByTestId('notepad-card-thread-n1'));
    expect(screen.getByTestId('notepad-thread-popover-n1')).toBeInTheDocument();
    await waitFor(() => expect(api.markNoteCommentsRead).toHaveBeenCalledWith('n1'));
    expect(unreadCountOf('n1')).toBe(0);
  });

  it('bubble “Read” opens the thread', async () => {
    card(note('n1'));
    act(() => ingestNoteComment(comment()));
    fireEvent.click(screen.getByTestId('notepad-card-bubble-read'));
    expect(screen.getByTestId('notepad-thread-popover-n1')).toBeInTheDocument();
    await waitFor(() => expect(api.markNoteCommentsRead).toHaveBeenCalledWith('n1'));
  });

  it('an entry that lands while the thread is open does not bubble', () => {
    card(note('n1'));
    fireEvent.click(screen.getByTestId('notepad-card-thread-n1'));
    act(() => ingestNoteComment(comment()));
    expect(screen.queryByTestId('notepad-card-bubble-n1')).toBeNull();
  });
});
