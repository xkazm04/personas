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

function makeQueue(
  items: TriageItem[],
  decide = vi.fn().mockResolvedValue(undefined),
  openLink = vi.fn(),
) {
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
    openLink,
    reload: vi.fn(),
  };
  return { queue, decide, openLink };
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

describe('useDeckControls — following a link is not deciding', () => {
  it('opens the run without throwing the card or writing a verdict', () => {
    const item = makeItem('review', {
      links: [{ id: 'run', label: 'See the run' }],
      payload: { executionId: 'exec-1' },
    });
    const { queue, decide, openLink } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    const launch = vi.fn();
    result.current.cardRef.current = { launch };

    act(() => result.current.followLink());
    expect(openLink).toHaveBeenCalledWith(item, 'run');
    // The card is still there, undecided, and still throwable.
    expect(decide).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it('does nothing on a card that offers no link', () => {
    const { queue, openLink } = makeQueue([makeItem('idea')]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    act(() => result.current.followLink());
    expect(openLink).not.toHaveBeenCalled();
  });
});

describe('useDeckControls — question cards', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refuses to submit an empty card and focuses the field instead', () => {
    const { queue, decide } = makeQueue([makeQuestion()]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    const focus = vi.fn();
    result.current.textareaRef.current = { focus } as unknown as HTMLTextAreaElement;

    act(() => result.current.decideTop('accept'));
    expect(decide).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it('still allows a reject — the queue decides it is a deferral, not the deck', () => {
    const item = makeQuestion();
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    act(() => result.current.decideTop('reject'));
    expect(decide).toHaveBeenCalledWith({ item, verdict: 'reject' });
  });

  it('collects every field of a session card into ONE decision', () => {
    const item = makeQuestion({
      input: {
        fields: [
          { key: 'tools', prompt: 'Which tools?', kind: 'text' },
          { key: 'tone', prompt: 'What tone?', kind: 'text' },
          { key: 'blank', prompt: 'Anything else?', kind: 'text' },
        ],
        deferred: false,
      },
    });
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    act(() => result.current.setAnswer('tools', 'gmail'));
    act(() => result.current.setAnswer('tone', ' formal '));
    expect(result.current.canAccept).toBe(true);

    act(() => result.current.decideTop('accept'));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith({
      item,
      verdict: 'accept',
      answers: { tools: 'gmail', tone: 'formal' },
    });
  });

  it('keeps partial answers when a poll re-identifies the card mid-typing', () => {
    // A poll that changes the session's pending set gives the card a NEW id
    // (see `questionGroupToTriage`). Drafts are keyed by session, so what the
    // reviewer already typed survives it — the old code wiped it on every
    // top-item change.
    const before = makeQuestion({
      id: 'question:sess-1:tone|tools',
      input: {
        fields: [
          { key: 'tools', prompt: 'Which tools?', kind: 'text' },
          { key: 'tone', prompt: 'What tone?', kind: 'text' },
        ],
        deferred: false,
      },
    });
    const after = makeQuestion({
      id: 'question:sess-1:tools',
      input: { fields: [{ key: 'tools', prompt: 'Which tools?', kind: 'text' }], deferred: false },
    });

    const decide = vi.fn().mockResolvedValue(undefined);
    const { rerender, result } = renderHook(({ items }) => useDeckControls(makeQueue(items, decide).queue, vi.fn()), {
      initialProps: { items: [before] },
    });

    act(() => result.current.setAnswer('tools', 'half typed'));
    rerender({ items: [after] });

    expect(result.current.answers.tools).toBe('half typed');
  });

  it('does not accept a fully deferred card — only its branch is real', () => {
    const item = makeQuestion({
      input: {
        fields: [{ key: 'creds', prompt: 'Which account?', kind: 'text', deferred: true }],
        deferred: true,
      },
      branches: [{ id: 'builder', label: 'Open in builder', tone: 'accent' }],
    });
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    expect(result.current.canAccept).toBe(false);
    act(() => result.current.decideTop('accept'));
    expect(decide).not.toHaveBeenCalled();

    act(() => result.current.fireBranch('builder'));
    expect(decide).toHaveBeenCalledWith({ item, verdict: 'accept', branchId: 'builder' });
  });
});
