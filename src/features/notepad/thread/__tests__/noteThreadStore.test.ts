// The thread store's COUNTING rules — the part a screenshot cannot check and a
// wrong one of which is a badge that lies: counts an entry twice, counts the
// operator's own words, or keeps a count for a thread he is looking at.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoteComment } from '@/lib/bindings/NoteComment';

const api = vi.hoisted(() => ({
  listNoteComments: vi.fn(),
  noteUnreadCounts: vi.fn(),
  markNoteCommentsRead: vi.fn(),
}));
vi.mock('@/api/notepad', () => api);

import {
  __resetNoteThreadStoreForTests,
  fetchThread,
  ingestNoteComment,
  latestUnreadIdOf,
  loadThreadUnread,
  markThreadRead,
  onNoteComment,
  setViewingThread,
  threadOf,
  unreadCountOf,
  useNoteThread,
  useNoteUnread,
  type NoteCommentArrival,
} from '../noteThreadStore';

let seq = 0;
function comment(over: Partial<NoteComment> = {}): NoteComment {
  seq += 1;
  return {
    id: `c${seq}`,
    noteId: 'n1',
    authorKind: 'athena',
    authorName: null,
    kind: 'comment',
    bodyMd: `entry ${seq}`,
    refKind: null,
    refId: null,
    verdict: null,
    createdAt: `2026-09-21T10:00:${String(seq).padStart(2, '0')}Z`,
    readAt: null,
    ...over,
  };
}

beforeEach(() => {
  __resetNoteThreadStoreForTests();
  api.listNoteComments.mockReset().mockResolvedValue([]);
  api.noteUnreadCounts.mockReset().mockResolvedValue([]);
  api.markNoteCommentsRead.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  __resetNoteThreadStoreForTests();
});

describe('unread counting', () => {
  it('bumps for an unread entry from anyone but the operator', () => {
    ingestNoteComment(comment({ authorKind: 'athena' }));
    ingestNoteComment(comment({ authorKind: 'agent' }));
    ingestNoteComment(comment({ authorKind: 'system', kind: 'system' }));
    expect(unreadCountOf('n1')).toBe(3);
  });

  it('never counts the operator’s own comment, nor an entry born read', () => {
    ingestNoteComment(comment({ authorKind: 'operator' }));
    ingestNoteComment(comment({ readAt: '2026-09-21T10:00:00Z' }));
    expect(unreadCountOf('n1')).toBe(0);
  });

  it('counts an id once — a replayed event, or a verdict update to a known row, is not a new entry', () => {
    const c = comment({ kind: 'review', verdict: 'pending' });
    ingestNoteComment(c);
    ingestNoteComment(c);
    ingestNoteComment({ ...c, verdict: 'approved' });
    expect(unreadCountOf('n1')).toBe(1);
  });

  it('tracks the newest unread entry as the bubble candidate', () => {
    ingestNoteComment(comment({ id: 'old' }));
    ingestNoteComment(comment({ id: 'new' }));
    expect(latestUnreadIdOf('n1')).toBe('new');
  });

  it('does not bump for the thread on screen, and tells the server it was read', () => {
    setViewingThread('n1');
    ingestNoteComment(comment());
    expect(unreadCountOf('n1')).toBe(0);
    expect(api.markNoteCommentsRead).toHaveBeenCalledWith('n1');
  });

  it('loadThreadUnread replaces the whole map — a note absent from the answer has nothing unread', async () => {
    ingestNoteComment(comment({ noteId: 'stale' }));
    api.noteUnreadCounts.mockResolvedValue([{ noteId: 'n2', unread: 4, latestId: 'x' }]);
    await loadThreadUnread();
    expect(unreadCountOf('stale')).toBe(0);
    expect(unreadCountOf('n2')).toBe(4);
    expect(latestUnreadIdOf('n2')).toBe('x');
  });

  it('keeps the last reading when the counts read fails', async () => {
    ingestNoteComment(comment());
    api.noteUnreadCounts.mockRejectedValue(new Error('down'));
    await loadThreadUnread();
    expect(unreadCountOf('n1')).toBe(1);
  });
});

describe('markThreadRead', () => {
  it('drops the badge BEFORE the server answers (optimistic)', async () => {
    ingestNoteComment(comment());
    let release!: () => void;
    api.markNoteCommentsRead.mockReturnValue(new Promise<void>((r) => (release = r)));
    const p = markThreadRead('n1');
    expect(unreadCountOf('n1')).toBe(0);
    release();
    await p;
    expect(unreadCountOf('n1')).toBe(0);
  });

  it('restores the count when the write fails — a badge that vanished on a write that did not land is a lie', async () => {
    ingestNoteComment(comment());
    ingestNoteComment(comment());
    api.markNoteCommentsRead.mockRejectedValue(new Error('nope'));
    await markThreadRead('n1');
    expect(unreadCountOf('n1')).toBe(2);
  });

  it('skips the IPC when there is nothing unread', async () => {
    await markThreadRead('n1');
    expect(api.markNoteCommentsRead).not.toHaveBeenCalled();
  });

  it('stamps readAt on the cached entries', async () => {
    api.listNoteComments.mockResolvedValue([comment({ id: 'a' })]);
    await fetchThread('n1');
    await loadThreadUnread();
    ingestNoteComment(comment({ id: 'b' }));
    await markThreadRead('n1');
    expect(threadOf('n1')?.entries.every((e) => e.readAt !== null)).toBe(true);
  });
});

describe('threads', () => {
  it('appends an incoming entry to a thread that is already loaded, in time order', async () => {
    const first = comment({ id: 'a' });
    api.listNoteComments.mockResolvedValue([first]);
    await fetchThread('n1');
    ingestNoteComment(comment({ id: 'b' }));
    expect(threadOf('n1')?.entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('does not invent a thread for a note nobody opened', () => {
    ingestNoteComment(comment());
    expect(threadOf('n1')).toBeUndefined();
  });

  it('replaces a known row with its newer reading (a verdict stamped)', async () => {
    const review = comment({ id: 'r', kind: 'review', verdict: 'pending' });
    api.listNoteComments.mockResolvedValue([review]);
    await fetchThread('n1');
    ingestNoteComment({ ...review, verdict: 'approved' });
    expect(threadOf('n1')?.entries).toHaveLength(1);
    expect(threadOf('n1')?.entries[0]?.verdict).toBe('approved');
  });

  it('merges an entry that arrived DURING the read instead of overwriting it', async () => {
    let answer!: (rows: NoteComment[]) => void;
    api.listNoteComments.mockReturnValue(new Promise<NoteComment[]>((r) => (answer = r)));
    const p = fetchThread('n1');
    ingestNoteComment(comment({ id: 'during' }));
    answer([comment({ id: 'stored' })]);
    await p;
    expect(threadOf('n1')?.entries.map((e) => e.id).sort()).toEqual(['during', 'stored']);
  });

  it('marks a failed read as failed rather than as an empty thread', async () => {
    api.listNoteComments.mockRejectedValue(new Error('down'));
    await fetchThread('n1');
    expect(threadOf('n1')).toMatchObject({ loading: false, failed: true });
  });

  it('useNoteThread fetches on mount and ghosts until the first read settles', async () => {
    api.listNoteComments.mockResolvedValue([comment({ id: 'a' })]);
    const { result } = renderHook(() => useNoteThread('n1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries.map((e) => e.id)).toEqual(['a']);
    expect(api.listNoteComments).toHaveBeenCalledTimes(1);
  });

  it('useNoteUnread re-renders on an incoming entry', () => {
    const { result } = renderHook(() => useNoteUnread('n1'));
    expect(result.current).toBe(0);
    act(() => ingestNoteComment(comment()));
    expect(result.current).toBe(1);
  });
});

describe('onNoteComment — the bubble feed', () => {
  it('announces a new non-operator entry once, with the count after it', () => {
    const seen: NoteCommentArrival[] = [];
    onNoteComment((a) => seen.push(a));
    const c = comment();
    ingestNoteComment(c);
    ingestNoteComment(c);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ unread: 1, viewed: false });
    expect(seen[0]?.comment.id).toBe(c.id);
  });

  it('stays silent for the operator’s own comment', () => {
    const fn = vi.fn();
    onNoteComment(fn);
    ingestNoteComment(comment({ authorKind: 'operator' }));
    expect(fn).not.toHaveBeenCalled();
  });

  it('unsubscribes', () => {
    const fn = vi.fn();
    const off = onNoteComment(fn);
    off();
    ingestNoteComment(comment());
    expect(fn).not.toHaveBeenCalled();
  });
});
