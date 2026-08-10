/**
 * What the deck says when it has no card to throw.
 *
 * There are four different reasons to run out — you finished, you filtered, you
 * reached the end of a BATCH, and the queue never answered — and the deck used
 * to render one of them for all four. "Deck cleared — nothing is waiting on you"
 * over a `list_manual_reviews` that threw is the single most damaging thing this
 * surface can say, because a reviewer who is told they are done stops looking.
 *
 * Each `describe` below pins one of those confusions:
 *  • a failed load NEVER reaches the cleared ending;
 *  • a partial failure is admitted while the deck keeps dealing;
 *  • cards skipped to exhaustion are stated instead of vanishing;
 *  • filtered and batched both keep their own action, instead of the louder one
 *    silencing the other and taking the only button with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { AriaLiveProvider } from '@/features/shared/components/feedback/AriaLiveProvider';

import { TriageDeckVariant } from '../TriageDeckVariant';
import { emptyCounts, type TriageCounts, type TriageItem, type TriageKind } from '../triageTypes';
import type { TriageBacklog, TriageSourceFailure, UnifiedTriageQueue } from '../useUnifiedTriage';
import { ALL_KINDS, makeItem } from './triageFixtures';

// This repo's test setup does not auto-cleanup.
afterEach(cleanup);

const EMPTY_SUMMARY = {
  decided: 0,
  accepted: 0,
  skipped: 0,
  undone: 0,
  conflicts: 0,
  medianDwellMs: null,
  byKind: [],
} as unknown as UnifiedTriageQueue['summary'];

const NO_BACKLOG: TriageBacklog = {
  loaded: 0,
  pending: 0,
  hasMore: false,
  remaining: 0,
  capped: [],
  more: false,
};

function makeQueue(over: Partial<UnifiedTriageQueue> = {}): UnifiedTriageQueue {
  return {
    items: [],
    cursor: 0,
    allCounts: emptyCounts(),
    loading: false,
    failures: [],
    activeKinds: new Set(ALL_KINDS),
    toggleKind: vi.fn(),
    showAllKinds: vi.fn(),
    decidedCount: 0,
    sessionTotal: 0,
    deferredCount: 0,
    skips: new Map(),
    focusItem: vi.fn(),
    backlog: NO_BACKLOG,
    loadMore: vi.fn(),
    summary: EMPTY_SUMMARY,
    undo: null,
    undoLast: vi.fn().mockResolvedValue(undefined),
    decide: vi.fn().mockResolvedValue(undefined),
    openLink: vi.fn(),
    reload: vi.fn(),
    ...over,
  };
}

function renderDeck(queue: UnifiedTriageQueue) {
  return render(
    <AriaLiveProvider>
      <TriageDeckVariant queue={queue} onClose={() => {}} title="Triage" />
    </AriaLiveProvider>,
  );
}

const failure = (source: TriageSourceFailure['source']): TriageSourceFailure => ({
  source,
  message: 'command not found',
});

/** `allCounts` with `kind` populated — what a switched-off kind still tallies. */
function countsWith(kind: TriageKind, n: number): TriageCounts {
  return { ...emptyCounts(), [kind]: n, total: n };
}

describe('a failed load never renders the cleared ending', () => {
  it('says the queue is UNREAD, not empty, and names what it could not read', () => {
    renderDeck(makeQueue({ failures: [failure('reviews')] }));

    expect(screen.getByTestId('deck-failed')).toBeInTheDocument();
    // The whole point: the reassuring ending must be unreachable here.
    expect(screen.queryByTestId('deck-cleared')).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing is waiting on you/i)).not.toBeInTheDocument();
    // And it says WHICH queue, so the reviewer knows what is missing.
    // Scoped to the ending: "Reviews" is also a filter chip in the top bar.
    expect(screen.getByTestId('deck-failed').textContent).toContain('Unread: Reviews');
  });

  it('offers a retry rather than a congratulation', () => {
    const reload = vi.fn();
    renderDeck(makeQueue({ failures: [failure('ideas')], reload }));

    screen.getByRole('button', { name: 'Try loading again' }).click();
    expect(reload).toHaveBeenCalled();
  });

  it('counts every failed source, not just the first', () => {
    renderDeck(makeQueue({ failures: [failure('ideas'), failure('goals')] }));
    expect(screen.getByTestId('deck-failed').textContent).toContain('2 queues');
  });
});

describe('a PARTIAL failure is admitted while the deck keeps dealing', () => {
  it('shows the unread-queue chip over a deck that still has cards', () => {
    const items: TriageItem[] = [makeItem('idea')];
    renderDeck(makeQueue({ items, failures: [failure('practices')] }));

    // Still dealing — the reviewer is not blocked …
    expect(screen.queryByTestId('deck-failed')).not.toBeInTheDocument();
    // … and the queue still admits it is short.
    expect(screen.getByTestId('deck-failure-chip').textContent).toContain('1 queue unread');
  });

  it('says nothing when every source answered', () => {
    renderDeck(makeQueue({ items: [makeItem('idea')] }));
    expect(screen.queryByTestId('deck-failure-chip')).not.toBeInTheDocument();
  });
});

describe('cards skipped to exhaustion are stated, not vanished', () => {
  it('names the deferrals in the cleared ending', () => {
    renderDeck(makeQueue({ deferredCount: 3, decidedCount: 2 }));

    expect(screen.getByTestId('deck-cleared')).toBeInTheDocument();
    expect(screen.getByTestId('deck-deferred-note').textContent).toContain('3 cards');
  });

  it('names them in the FAILED ending too — the two facts are independent', () => {
    renderDeck(makeQueue({ deferredCount: 1, failures: [failure('policy')] }));
    expect(screen.getByTestId('deck-deferred-note').textContent).toContain('1 card');
  });

  it('stays quiet when nothing was deferred', () => {
    renderDeck(makeQueue({ decidedCount: 4 }));
    expect(screen.queryByTestId('deck-deferred-note')).not.toBeInTheDocument();
  });
});

describe('filtered and batched each keep their own action', () => {
  const filteredQueue = (over: Partial<UnifiedTriageQueue> = {}) =>
    makeQueue({
      // A kind switched off that still has live items — what `filteredOut` is.
      activeKinds: new Set<TriageKind>(['review']),
      allCounts: countsWith('idea', 4),
      ...over,
    });

  it('gives the filtered ending a way back — it used to render NO button', () => {
    const showAllKinds = vi.fn();
    renderDeck(filteredQueue({ showAllKinds }));

    screen.getByRole('button', { name: 'Show every kind' }).click();
    expect(showAllKinds).toHaveBeenCalled();
  });

  it('keeps the batch action reachable from a FILTERED deck', () => {
    // `batched` was `!filtered && remaining > 0`, so this combination rendered
    // the filtered ending and the capped backlog became unreachable.
    const loadMore = vi.fn();
    renderDeck(
      filteredQueue({
        loadMore,
        backlog: { ...NO_BACKLOG, hasMore: true, pending: 400, loaded: 60, remaining: 340 },
      }),
    );

    screen.getByRole('button', { name: 'Deal the next batch' }).click();
    expect(loadMore).toHaveBeenCalled();
    // And the filtered fact keeps its own action beside it.
    expect(screen.getByRole('button', { name: 'Show every kind' })).toBeInTheDocument();
  });

  it('always offers "check for more" — the only way back to a deferral', () => {
    renderDeck(filteredQueue({ deferredCount: 2 }));
    expect(screen.getByRole('button', { name: 'Check for more' })).toBeInTheDocument();
  });
});

describe('a source read at a fixed limit is not a finished queue', () => {
  it('refuses the cleared headline when a capped source came back full', () => {
    renderDeck(
      makeQueue({ backlog: { ...NO_BACKLOG, capped: ['policy'], more: true }, decidedCount: 5 }),
    );

    const ending = screen.getByTestId('deck-cleared');
    expect(ending.textContent).not.toContain('nothing is waiting on you');
    expect(ending.textContent).toContain('a page at a time');
  });

  it('does NOT offer "deal the next batch" when there is no next page to deal', () => {
    // `loadMore` pages the idea keyset. A deck that is batched only because a
    // fixed-limit ledger was full has no cursor, so the button would no-op.
    renderDeck(makeQueue({ backlog: { ...NO_BACKLOG, capped: ['evolution'], more: true } }));

    expect(screen.queryByRole('button', { name: 'Deal the next batch' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for more' })).toBeInTheDocument();
  });
});
