/**
 * The deck's input lock.
 *
 * `pendingRef` is both the queued decision AND the in-flight lock, so a card
 * that is thrown and never reports back leaves the lock shut and kills every
 * later verdict — keyboard, flanks and action bar all dead until the surface is
 * closed and reopened. That is exactly what happened when the LAST card in the
 * deck was skipped: it was re-dealt as the same top card, its `launchedRef`
 * still latched, and nothing ever committed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDeckControls } from '../deck/useDeckControls';
import type { TriageItem } from '../triageTypes';
import type { UnifiedTriageQueue } from '../useUnifiedTriage';
import { emptyCounts } from '../triageTypes';
import { makeItem, makeQuestion } from './triageFixtures';

function makeQueue(items: TriageItem[], decide = vi.fn().mockResolvedValue(undefined)) {
  const queue: UnifiedTriageQueue = {
    items,
    allCounts: emptyCounts(),
    loading: false,
    activeKinds: new Set(['review', 'idea', 'practice', 'question']),
    toggleKind: vi.fn(),
    decidedCount: 0,
    sessionTotal: items.length,
    deferredCount: 0,
    skips: new Map(),
    decide,
    reload: vi.fn(),
  };
  return { queue, decide };
}

describe('useDeckControls — a thrown card that never lands', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lands the decision anyway and leaves the deck usable', () => {
    const item = makeItem('idea');
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    // A card whose flight is never reported — the re-dealt last card.
    const launch = vi.fn();
    result.current.cardRef.current = { launch };

    act(() => result.current.decideTop('skip'));
    expect(launch).toHaveBeenCalledWith('down');
    expect(decide).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1200));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith({ item, verdict: 'skip' });

    // The lock is open again: the very next verdict is accepted, where before
    // every subsequent one was swallowed.
    act(() => result.current.decideTop('accept'));
    expect(launch).toHaveBeenCalledTimes(2);
    act(() => void vi.advanceTimersByTime(1200));
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it('does not double-decide when the card DOES report its flight', () => {
    const item = makeItem('review');
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));
    result.current.cardRef.current = { launch: vi.fn() };

    act(() => result.current.decideTop('reject'));
    act(() => result.current.commit('left'));
    expect(decide).toHaveBeenCalledTimes(1);

    act(() => void vi.advanceTimersByTime(5000));
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('decides outright when there is no card to throw', () => {
    const item = makeItem('practice');
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    act(() => result.current.decideTop('accept'));
    expect(decide).toHaveBeenCalledWith({ item, verdict: 'accept' });
  });
});

describe('useDeckControls — question cards', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refuses to submit an empty answer and focuses the field instead', () => {
    const item = makeQuestion({ input: { kind: 'text' } });
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    const focus = vi.fn();
    result.current.textareaRef.current = { focus } as unknown as HTMLTextAreaElement;

    act(() => result.current.decideTop('accept'));
    expect(decide).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it('still allows a reject — the queue decides it is a deferral, not the deck', () => {
    const item = makeQuestion({ input: { kind: 'text' } });
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    act(() => result.current.decideTop('reject'));
    expect(decide).toHaveBeenCalledWith({ item, verdict: 'reject' });
  });
});
