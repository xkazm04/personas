// The router between the card bubble and the LiveCommsStack: an entry goes to
// the stack exactly when its card is NOT on screen and its thread was not open.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoteComment } from '@/lib/bindings/NoteComment';

const api = vi.hoisted(() => ({
  listNoteComments: vi.fn(async () => [] as NoteComment[]),
  noteUnreadCounts: vi.fn(async () => []),
  markNoteCommentsRead: vi.fn(async () => undefined),
}));
vi.mock('@/api/notepad', async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

import { __resetLiveExternalForTests, liveSourceFor, onExternalLiveMessage } from '@/features/fleet/monitor/live/liveExternal';
import type { LiveMessage } from '@/features/fleet/monitor/live/liveModel';

import { __resetCardVisibilityForTests, registerVisibleCard } from '../cardVisibility';
import { NotepadLiveFeeder } from '../NotepadLiveFeeder';
import { __resetNoteThreadStoreForTests, ingestNoteComment, setViewingThread } from '../noteThreadStore';

let seq = 0;
const comment = (over: Partial<NoteComment> = {}): NoteComment => {
  seq += 1;
  return {
    id: `f${seq}`,
    noteId: 'n1',
    authorKind: 'athena',
    authorName: null,
    kind: 'comment',
    bodyMd: 'A **thought** on the scope.',
    refKind: null,
    refId: null,
    verdict: null,
    createdAt: '2026-09-21T10:00:00Z',
    readAt: null,
    ...over,
  };
};

let pushed: LiveMessage[] = [];
let unsub: () => void = () => {};

beforeEach(() => {
  __resetLiveExternalForTests();
  __resetNoteThreadStoreForTests();
  __resetCardVisibilityForTests();
  pushed = [];
  unsub = onExternalLiveMessage((m) => pushed.push(m));
  render(<NotepadLiveFeeder />);
});

afterEach(() => {
  unsub();
  cleanup();
});

describe('NotepadLiveFeeder', () => {
  it('routes an entry for a note with no card on screen to the stack', () => {
    act(() => ingestNoteComment(comment()));
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ source: 'notepad', noteId: 'n1', kind: 'athena', message: 'A thought on the scope.' });
  });

  it('leaves it to the card bubble while the card is mounted', () => {
    const release = registerVisibleCard('n1');
    act(() => ingestNoteComment(comment()));
    expect(pushed).toHaveLength(0);
    release();
    act(() => ingestNoteComment(comment()));
    expect(pushed).toHaveLength(1);
  });

  it('sends nothing for a thread that is open (it is read on arrival)', () => {
    setViewingThread('n1');
    act(() => ingestNoteComment(comment()));
    expect(pushed).toHaveLength(0);
  });

  it('marks a pending review as an alert with its review metadata', () => {
    act(() => ingestNoteComment(comment({ kind: 'review', authorKind: 'agent', authorName: 'note-task', refKind: 'run', refId: 'r', verdict: 'pending' })));
    expect(pushed[0]).toMatchObject({ alert: true, kind: 'persona', review: { refKind: 'run', pending: true } });
  });

  it('registers the notepad verbs, and acknowledging marks the thread read', async () => {
    act(() => ingestNoteComment(comment()));
    const source = liveSourceFor(pushed[0]!);
    expect(source?.renderActions).toBeTypeOf('function');
    source?.acknowledge?.(pushed[0]!);
    await vi.waitFor(() => expect(api.markNoteCommentsRead).toHaveBeenCalledWith('n1'));
  });
});
