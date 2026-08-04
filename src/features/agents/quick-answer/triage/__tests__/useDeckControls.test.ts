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
import type { TriageItem, TriageKind } from '../triageTypes';
import type { TriageUndo, UnifiedTriageQueue } from '../useUnifiedTriage';
import { emptyCounts, TRIAGE_KINDS } from '../triageTypes';
import { clearTriageSession, resetTriageSessionCache } from '../triageSession';
import { makeItem, makeQuestion } from './triageFixtures';

function makeQueue(
  items: TriageItem[],
  decide = vi.fn().mockResolvedValue(undefined),
  openLink = vi.fn(),
  extra: { undo?: TriageUndo | null; undoLast?: () => Promise<void> } = {},
) {
  const undoLast = extra.undoLast ?? vi.fn().mockResolvedValue(undefined);
  const queue: UnifiedTriageQueue = {
    items,
    allCounts: emptyCounts(),
    loading: false,
    activeKinds: new Set<TriageKind>(TRIAGE_KINDS),
    toggleKind: vi.fn(),
    decidedCount: 0,
    sessionTotal: items.length,
    deferredCount: 0,
    skips: new Map(),
    backlog: { loaded: items.length, pending: items.length, hasMore: false },
    loadMore: vi.fn(),
    summary: {
      decided: 0,
      accepted: 0,
      rejected: 0,
      skipped: 0,
      undone: 0,
      conflicts: 0,
      medianDwellMs: null,
      byKind: [],
    },
    undo: extra.undo ?? null,
    undoLast,
    decide,
    openLink,
    reload: vi.fn(),
  };
  return { queue, decide, openLink, undoLast };
}

// Drafts are DURABLE now, so a test that types must not leave that typing
// behind for the next one.
beforeEach(() => {
  clearTriageSession();
  resetTriageSessionCache();
});

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

describe('useDeckControls — rejections that teach', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const REJECT_PROMPT = {
    on: 'reject',
    title: 'Why?',
    options: [
      { id: 'out_of_scope', label: 'Out of scope', value: 'Out of scope' },
      { id: 'by_design', label: 'Working as intended', value: 'Working as intended' },
    ],
    skipLabel: 'No reason',
    freeText: true,
  } as const;

  const withPrompt = (kind: 'idea' | 'review' = 'idea') =>
    makeItem(kind, { reasonPrompts: [{ ...REJECT_PROMPT, options: [...REJECT_PROMPT.options] }] });

  it('asks before the card flies, then writes the picked reason', () => {
    const item = withPrompt();
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));
    const launch = vi.fn();
    result.current.cardRef.current = { launch };

    act(() => result.current.decideTop('reject'));
    // Nothing written and nothing thrown yet — the reviewer can still see what
    // they are rejecting.
    expect(result.current.capture?.prompt.on).toBe('reject');
    expect(decide).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();

    act(() => result.current.resolveReason('Out of scope'));
    expect(launch).toHaveBeenCalledWith('left');
    act(() => void vi.advanceTimersByTime(1200));
    expect(decide).toHaveBeenCalledWith({
      item,
      verdict: 'reject',
      branchId: undefined,
      reason: 'Out of scope',
    });
  });

  it('still writes the rejection when the reason is skipped', () => {
    const item = withPrompt('review');
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));
    result.current.cardRef.current = { launch: vi.fn() };

    act(() => result.current.decideTop('reject'));
    act(() => result.current.resolveReason());
    act(() => void vi.advanceTimersByTime(1200));

    expect(decide).toHaveBeenCalledWith({
      item,
      verdict: 'reject',
      branchId: undefined,
      reason: undefined,
    });
  });

  it('treats a whitespace-only reason as no reason rather than writing blanks', () => {
    const item = withPrompt();
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));
    result.current.cardRef.current = { launch: vi.fn() };

    act(() => result.current.decideTop('reject'));
    act(() => result.current.resolveReason('   '));
    act(() => void vi.advanceTimersByTime(1200));

    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'reject', reason: undefined }),
    );
  });

  it('asks AFTER a left flick, and does not throw the card a second time', () => {
    // The gesture is the point of the surface: catching the card mid-air to
    // interrogate the reviewer would undo the flick they just made.
    const item = withPrompt();
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));
    const launch = vi.fn();
    result.current.cardRef.current = { launch };

    act(() => result.current.commit('left'));
    expect(result.current.capture?.thrown).toBe(true);
    expect(decide).not.toHaveBeenCalled();

    act(() => result.current.resolveReason('Working as intended'));
    expect(launch).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'reject', reason: 'Working as intended' }),
    );
  });

  it('lets a right flick through untouched — only rejections are asked about', () => {
    const { queue, decide } = makeQueue([withPrompt()]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));

    act(() => result.current.commit('right'));
    expect(result.current.capture).toBeNull();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'accept' }));
  });

  it('rejects outright when the item has no prompt', () => {
    const item = makeItem('practice');
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));
    result.current.cardRef.current = { launch: vi.fn() };

    act(() => result.current.decideTop('reject'));
    expect(result.current.capture).toBeNull();
    act(() => void vi.advanceTimersByTime(1200));
    expect(decide).toHaveBeenCalledWith({ item, verdict: 'reject' });
  });

  it('accepts nothing else while a reason is outstanding', () => {
    const { queue, decide } = makeQueue([withPrompt()]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));
    result.current.cardRef.current = { launch: vi.fn() };

    act(() => result.current.decideTop('reject'));
    act(() => result.current.decideTop('accept'));
    act(() => result.current.decideTop('skip'));
    expect(decide).not.toHaveBeenCalled();
    expect(result.current.capture).not.toBeNull();
  });

  it('qualifies a BRANCH with a successor instead of a reason', () => {
    const item = makeItem('practice', {
      branches: [{ id: 'deprecate', label: 'Deprecate', tone: 'neutral' }],
      reasonPrompts: [
        {
          on: 'deprecate',
          title: 'Replaced by',
          options: [{ id: 'k-2', label: 'The newer take', value: 'k-2' }],
          skipLabel: 'No successor',
          freeText: false,
        },
      ],
    });
    const { queue, decide } = makeQueue([item]);
    const { result } = renderHook(() => useDeckControls(queue, vi.fn()));
    result.current.cardRef.current = { launch: vi.fn() };

    act(() => result.current.fireBranch('deprecate'));
    expect(result.current.capture?.branchId).toBe('deprecate');

    act(() => result.current.resolveReason('k-2'));
    act(() => void vi.advanceTimersByTime(1200));
    expect(decide).toHaveBeenCalledWith({
      item,
      verdict: 'accept',
      branchId: 'deprecate',
      reason: 'k-2',
    });
  });

  it('drops the capture when the card leaves the queue under it', () => {
    const item = withPrompt();
    const decide = vi.fn().mockResolvedValue(undefined);
    const { rerender, result } = renderHook(
      ({ items }) => useDeckControls(makeQueue(items, decide).queue, vi.fn()),
      { initialProps: { items: [item] } },
    );

    act(() => result.current.decideTop('reject'));
    expect(result.current.capture).not.toBeNull();

    // Another surface resolved it, or a poll dropped it: there is nothing left
    // to write, so the strip must not sit there forever.
    rerender({ items: [] });
    expect(result.current.capture).toBeNull();
    expect(decide).not.toHaveBeenCalled();
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

describe('useDeckControls — the deck remembers what you were typing', () => {
  it('restores a half-typed answer after the deck is CLOSED and reopened', () => {
    // Not a poll this time: `QuickAnswerPopover` unmounts whenever the header
    // overlay changes, so stepping away to look at anything threw the answer
    // away outright.
    vi.useFakeTimers();
    try {
      const item = makeQuestion({ sourceId: 'sess-9' });
      const first = renderHook(() => useDeckControls(makeQueue([item]).queue, vi.fn()));
      act(() => first.result.current.setAnswer('tools', 'half a sen'));
      // The debounce has not fired; the unmount flush is what must save it.
      first.unmount();

      const second = renderHook(() => useDeckControls(makeQueue([item]).queue, vi.fn()));
      expect(second.result.current.answers.tools).toBe('half a sen');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useDeckControls — U takes the last act back', () => {
  const press = (key: string) =>
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

  it('calls the queue only when there is something to undo', () => {
    const item = makeItem('idea');
    const armed: TriageUndo = {
      type: 'skip',
      itemId: item.id,
      label: 'Skip',
      at: Date.now(),
    };

    const cold = makeQueue([item], vi.fn().mockResolvedValue(undefined), vi.fn(), { undo: null });
    const { unmount } = renderHook(() => useDeckControls(cold.queue, vi.fn()));
    press('u');
    expect(cold.undoLast).not.toHaveBeenCalled();
    unmount();

    const hot = makeQueue([item], vi.fn().mockResolvedValue(undefined), vi.fn(), { undo: armed });
    renderHook(() => useDeckControls(hot.queue, vi.fn()));
    press('U');
    expect(hot.undoLast).toHaveBeenCalledTimes(1);
  });

  it('is a BARE letter, so a modifier chord still belongs to the browser', () => {
    // The deck owns the keyboard exclusively; binding mod+Z here would swallow
    // the undo a reviewer expects inside the reason strip's text box.
    const item = makeItem('idea');
    const armed: TriageUndo = { type: 'skip', itemId: item.id, label: 'Skip', at: Date.now() };
    const hot = makeQueue([item], vi.fn().mockResolvedValue(undefined), vi.fn(), { undo: armed });
    renderHook(() => useDeckControls(hot.queue, vi.fn()));

    act(() =>
      void window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      ),
    );
    expect(hot.undoLast).not.toHaveBeenCalled();
  });
});
