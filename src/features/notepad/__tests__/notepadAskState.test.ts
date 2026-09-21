// The "Athena is working" wait, lifted out of the dispatch bar. What is pinned
// is the claim it makes and when it must stop making it: the three ways a wait
// ends, and that it ends for THAT note only.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoteComment } from '@/lib/bindings/NoteComment';

vi.mock('@/api/notepad', () => ({
  markNoteCommentsRead: vi.fn().mockResolvedValue(undefined),
}));

import {
  ASK_CEILING_MS,
  __resetNoteAskStateForTests,
  askingNoteIds,
  clearAsk,
  noteAskOf,
  reportSuggestionCount,
  startAsk,
  useNoteAsking,
} from '../notepadAskState';
import { __resetNoteThreadStoreForTests, ingestNoteComment } from '../thread/noteThreadStore';

const entry = (over: Partial<NoteComment>): NoteComment => ({
  id: 'c1',
  noteId: 'n1',
  authorKind: 'athena',
  authorName: null,
  kind: 'review',
  bodyMd: 'Suggestions ready',
  refKind: 'suggestion_card',
  refId: 'card-1',
  verdict: 'pending',
  createdAt: '2026-09-21T10:00:00Z',
  readAt: null,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  __resetNoteAskStateForTests();
  __resetNoteThreadStoreForTests();
});

afterEach(() => {
  __resetNoteAskStateForTests();
  __resetNoteThreadStoreForTests();
  vi.useRealTimers();
});

describe('notepadAskState', () => {
  it('opens a wait keyed by note, clocked from the ask', () => {
    vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
    startAsk('n1', 2);
    expect(noteAskOf('n1')).toEqual({ since: '2026-09-21T10:00:00.000Z', suggestionsAtAsk: 2 });
    expect(noteAskOf('n2')).toBeNull();
    expect(askingNoteIds()).toEqual(['n1']);
  });

  it('gives up at the ceiling — an indicator that cannot end is worse than none', () => {
    startAsk('n1');
    vi.advanceTimersByTime(ASK_CEILING_MS - 1);
    expect(noteAskOf('n1')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(noteAskOf('n1')).toBeNull();
  });

  it('a second ask restarts the ceiling', () => {
    startAsk('n1');
    vi.advanceTimersByTime(ASK_CEILING_MS - 10);
    startAsk('n1');
    vi.advanceTimersByTime(20);
    expect(noteAskOf('n1')).not.toBeNull();
  });

  it('ends when the note’s open-suggestion count RISES past the count at the ask', () => {
    startAsk('n1', 2);
    reportSuggestionCount('n1', 2);
    expect(noteAskOf('n1')).not.toBeNull();
    reportSuggestionCount('n1', 1);
    expect(noteAskOf('n1')).not.toBeNull();
    reportSuggestionCount('n1', 3);
    expect(noteAskOf('n1')).toBeNull();
  });

  it('ends when an Athena entry lands in that note’s thread — and only that note’s', () => {
    startAsk('n1');
    startAsk('n2');
    ingestNoteComment(entry({ id: 'x', noteId: 'n1' }));
    expect(noteAskOf('n1')).toBeNull();
    expect(noteAskOf('n2')).not.toBeNull();
  });

  it('is not ended by an agent or system entry — those are not her answer', () => {
    startAsk('n1');
    ingestNoteComment(entry({ id: 'a', authorKind: 'agent', refKind: 'run' }));
    ingestNoteComment(entry({ id: 's', authorKind: 'system', kind: 'system', verdict: null }));
    expect(noteAskOf('n1')).not.toBeNull();
  });

  it('clearAsk cancels the ceiling timer', () => {
    startAsk('n1');
    clearAsk('n1');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('useNoteAsking follows the store', () => {
    const { result } = renderHook(() => useNoteAsking('n1'));
    expect(result.current).toBeNull();
    act(() => startAsk('n1'));
    expect(result.current).not.toBeNull();
    act(() => vi.advanceTimersByTime(ASK_CEILING_MS));
    expect(result.current).toBeNull();
  });
});
