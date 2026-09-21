// The desk driven by the keyboard alone, through the real AppKeyboardProvider
// and a stand-in for the host's own Escape ladder at the same layer priority:
// the lamp, Find, the cheat sheet, the typing rule, the rails, and the review
// keys that act on a card's bubble before its thread.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';
import { AppKeyboardProvider, NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
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

import { __resetNoteThreadStoreForTests, ingestNoteComment } from '../../thread/noteThreadStore';
import { __resetCardVisibilityForTests } from '../../thread/cardVisibility';
import { NoteOverview } from '../NoteOverview';

const note = (id: string, title: string, over: Partial<DevNote> = {}): DevNote =>
  ({
    id,
    projectId: 'p1',
    milestoneId: null,
    title,
    bodyMd: `body of ${id}`,
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
const comment = (noteId: string, over: Partial<NoteComment> = {}): NoteComment => {
  seq += 1;
  return {
    id: `c${seq}`,
    noteId,
    authorKind: 'athena',
    authorName: null,
    kind: 'comment',
    bodyMd: 'One question about the scope.',
    refKind: null,
    refId: null,
    verdict: null,
    createdAt: '2026-09-21T10:00:00Z',
    readAt: null,
    ...over,
  };
};

const projects: DevProject[] = [{ id: 'p1', name: 'personas', root_path: '/a' } as DevProject];
// Six notes on a 4-column grid:  n1 n2 n3 n4 / n5 n6
const notes = [
  note('n1', 'Alpha plan'),
  note('n2', 'Beta refactor'),
  note('n3', 'Gamma idea', { bodyMd: 'the sweeper moves it' }),
  note('n4', 'Delta'),
  note('n5', 'Epsilon'),
  note('n6', 'Zeta'),
];

/** Stands in for NotepadOverlayHost: a PARENT registering at the pad's layer
 *  priority, whose Escape closes the pad. A parent's effect runs after its
 *  child's, so at an equal priority it would be asked first. */
function Host({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return false;
      onClose();
      return true;
    },
    { priority: NOTEPAD_LAYER_PRIORITY },
  );
  return <>{children}</>;
}

function desk(hostClose: () => void = vi.fn()) {
  const props = {
    onOpen: vi.fn(),
    onPatch: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onCertify: vi.fn(),
  };
  render(
    <AppKeyboardProvider>
      <Host onClose={hostClose}>
        <NoteOverview
          loading={false}
          notes={notes}
          projects={projects}
          saveStates={{}}
          atCap={false}
          focusNoteId={null}
          {...props}
        />
      </Host>
    </AppKeyboardProvider>,
  );
  return props;
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
  });

const selectedId = () => document.querySelector('[data-selected="true"]')?.getAttribute('data-desk-id') ?? null;

beforeEach(() => {
  __resetNoteThreadStoreForTests();
  __resetCardVisibilityForTests();
  useSystemStore.setState({ fleetSessions: [] });
  document.documentElement.setAttribute('data-motion', 'reduce');
  localStorage.clear();
  // jsdom has no layout, so no scrolling either; the lamp scrolls its card in.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

describe('the desk from the keyboard', () => {
  it('the lamp starts on the first note and walks the grid with the arrows', () => {
    desk();
    expect(selectedId()).toBe('n1');
    press('ArrowRight');
    expect(selectedId()).toBe('n2');
    press('ArrowDown');
    expect(selectedId()).toBe('n6');
    press('ArrowUp');
    expect(selectedId()).toBe('n2');
    press('ArrowLeft');
    press('ArrowLeft');
    // Arrows clamp at the edge (a desk); j / k wrap (a list).
    expect(selectedId()).toBe('n1');
    press('k');
    expect(selectedId()).toBe('n6');
    press('Home');
    expect(selectedId()).toBe('n1');
    press('End');
    expect(selectedId()).toBe('n6');
  });

  it('Enter opens the selected note and Delete routes to the host', () => {
    const props = desk();
    press('j');
    press('Enter');
    expect(props.onOpen).toHaveBeenCalledWith('n2');
    press('Delete');
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'n2' }));
  });

  it('/ opens Find and focuses it; typing narrows; Esc clears, then closes, then the host steps out', async () => {
    const hostClose = vi.fn();
    desk(hostClose);
    press('/');
    const find = await screen.findByTestId('notepad-desk-search');
    await waitFor(() => expect(document.activeElement).toBe(find));

    fireEvent.change(find, { target: { value: 'sweeper' } });
    await waitFor(() => expect(screen.queryByTestId('notepad-card-n1')).toBeNull());
    expect(screen.getByTestId('notepad-card-n3')).toBeInTheDocument();
    expect(selectedId()).toBe('n3');
    // Letters typed into the field never move the lamp.
    press('j');
    expect(selectedId()).toBe('n3');

    // Rung 1: clear the query — the desk, not the host, even though the host
    // registered later at the pad's own priority.
    press('Escape');
    expect((find as HTMLInputElement).value).toBe('');
    expect(hostClose).not.toHaveBeenCalled();
    // Rung 2: close the field.
    press('Escape');
    await waitFor(() => expect(screen.queryByTestId('notepad-desk-search')).toBeNull());
    expect(hostClose).not.toHaveBeenCalled();
    // Nothing left on the desk's own rungs: the next Escape is the host's.
    press('Escape');
    expect(hostClose).toHaveBeenCalledTimes(1);
  });

  it('? opens the cheat sheet; its Escape closes it before the host ladder runs', async () => {
    const hostClose = vi.fn();
    desk(hostClose);
    press('?', { shiftKey: true });
    expect(await screen.findByTestId('notepad-desk-cheat')).toBeInTheDocument();
    press('Escape');
    await waitFor(() => expect(screen.queryByTestId('notepad-desk-cheat')).toBeNull());
    expect(hostClose).not.toHaveBeenCalled();
  });

  it('never acts on a key while the capture line has focus', () => {
    const props = desk();
    const capture = screen.getByTestId('notepad-overview-capture');
    act(() => capture.focus());
    press('j');
    press('ArrowRight');
    press('Delete');
    press('p');
    press('/');
    press('?', { shiftKey: true });
    expect(selectedId()).toBe('n1');
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId('notepad-desk-search')).toBeNull();
    expect(screen.queryByTestId('notepad-desk-cheat')).toBeNull();
  });

  it('1 / 2 / 3 switch the rails', async () => {
    desk();
    press('2');
    // Every fixture note is a draft: the Scoped rail is empty.
    await waitFor(() => expect(screen.queryByTestId('notepad-card-n1')).toBeNull());
    press('3');
    await waitFor(() => expect(screen.getByTestId('notepad-card-n1')).toBeInTheDocument());
  });

  it('the hint rail shows y / n only while the selected card has a pending review up', () => {
    desk();
    expect(screen.queryByTestId('notepad-desk-hint-approve')).toBeNull();
    act(() =>
      ingestNoteComment(comment('n1', { kind: 'review', authorKind: 'agent', refKind: 'run', refId: 'r1', verdict: 'pending' })),
    );
    expect(screen.getByTestId('notepad-desk-hint-approve')).toBeInTheDocument();
    expect(screen.getByTestId('notepad-desk-hint-reject')).toBeInTheDocument();
  });
});

describe('review keys — the bubble first, the thread otherwise', () => {
  it('r focuses the bubble’s inline Comment field when a bubble is up', async () => {
    desk();
    act(() => ingestNoteComment(comment('n1')));
    expect(screen.getByTestId('notepad-card-bubble-n1')).toBeInTheDocument();
    press('r');
    const field = await screen.findByTestId('notepad-card-bubble-comment-input');
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(screen.queryByTestId('notepad-thread-popover-n1')).toBeNull();
  });

  it('r opens the thread composer when no bubble is up', async () => {
    desk();
    press('r');
    expect(await screen.findByTestId('notepad-thread-popover-n1')).toBeInTheDocument();
  });

  it('n on a pending run review opens the bubble’s reject-reason field', async () => {
    desk();
    act(() =>
      ingestNoteComment(comment('n1', { kind: 'review', authorKind: 'agent', refKind: 'run', refId: 'r1', verdict: 'pending' })),
    );
    press('n');
    const reason = await screen.findByTestId('notepad-card-bubble-review-reason');
    await waitFor(() => expect(document.activeElement).toBe(reason));
    expect(screen.queryByTestId('notepad-thread-popover-n1')).toBeNull();
  });

  it('n without a pending review falls back to the thread', async () => {
    desk();
    act(() => ingestNoteComment(comment('n1')));
    press('n');
    expect(await screen.findByTestId('notepad-thread-popover-n1')).toBeInTheDocument();
  });
});
