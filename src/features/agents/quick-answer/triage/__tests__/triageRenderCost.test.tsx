/**
 * What a keystroke costs.
 *
 * The deck keeps THREE cards mounted for depth, and the draft answer lives one
 * level up in `useDeckControls`. So every character typed into a question card
 * re-rendered all three cards, and each one re-ran up to two
 * `MarkdownRenderer`s (react-markdown + remark-gfm + rehype-highlight) over
 * prose that had not changed.
 *
 * `MarkdownRenderer` is mocked with a spy, which makes the regression directly
 * measurable rather than a claim: the assertion is that typing does not re-parse
 * the markdown of ANY card, and specifically not of the two behind the top one.
 *
 * This test is also the guard on the identity chain. `TriageCard` is `memo`'d,
 * but memo only holds while its props are stable — `onCommit` closes over the
 * queue object, so one un-memoised hook return anywhere above the deck silently
 * puts the cost straight back.
 */
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { useCallback, useState } from 'react';
import { cleanup, render, fireEvent, screen } from '@testing-library/react';

const markdownSpy = vi.fn();

vi.mock('@/features/shared/components/editors/MarkdownRenderer', () => ({
  MarkdownRenderer: (props: { content: string }) => {
    markdownSpy(props.content);
    return <div data-testid="markdown">{props.content}</div>;
  },
}));

/**
 * One tick per COMPONENT RENDER, across the whole deck.
 *
 * Every component under this surface calls `useTranslation()` exactly once when
 * it renders, so wrapping the real hook turns "how much of the deck rebuilt" into
 * a number a test can assert on. It measures the real components — nothing under
 * test is stubbed out — which is the only way a memoisation claim can be checked
 * rather than asserted.
 */
const renderTick = vi.fn();

vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return {
    ...actual,
    useTranslation: () => {
      renderTick();
      return actual.useTranslation();
    },
  };
});

import { AriaLiveProvider } from '@/features/shared/components/feedback/AriaLiveProvider';

import { TriageDeckVariant } from '../TriageDeckVariant';
import { TriageCard, type FlingDirection } from '../deck/TriageCard';
import { emptyCounts } from '../triageTypes';
import type { TriageBacklog, UnifiedTriageQueue } from '../useUnifiedTriage';
import { ALL_KINDS, makeItem, makeQuestion } from './triageFixtures';

/**
 * The deck's shape, reduced to the thing under test: a parent that owns the
 * answer draft and renders a stack of cards below it.
 */
function DeckHarness({ stack }: { stack: ReturnType<typeof makeItem>[] }) {
  const [answer, setAnswer] = useState('');
  // Stable, exactly as `useDeckControls` provides it once the queue object above
  // it is memoised.
  const onCommit = useCallback((_dir: FlingDirection) => {}, []);

  return (
    <div>
      <input
        aria-label="answer"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      {stack.map((item, i) => (
        <TriageCard
          key={item.id}
          item={item}
          index={i}
          draggable
          reduced
          cycle={0}
          onCommit={onCommit}
        />
      ))}
    </div>
  );
}

const stack = () => [
  makeItem('review', { sourceId: 'a', body: 'first card body', reasoning: 'first reasoning' }),
  makeItem('idea', { sourceId: 'b', body: 'second card body' }),
  makeItem('practice', { sourceId: 'c', body: 'third card body' }),
];

beforeEach(() => {
  markdownSpy.mockClear();
  renderTick.mockClear();
});
// This repo's test setup does not auto-cleanup, and the deck-level tests below
// mount a full-screen dialog.
afterEach(cleanup);

describe('the deck stack does not re-parse on every keystroke', () => {
  it('parses each card once on mount', () => {
    render(<DeckHarness stack={stack()} />);
    // Three bodies + one `reasoning` block on the first card.
    expect(markdownSpy).toHaveBeenCalledTimes(4);
  });

  it('parses NOTHING again when the parent answer state changes', () => {
    render(<DeckHarness stack={stack()} />);
    const mounted = markdownSpy.mock.calls.length;
    expect(mounted).toBeGreaterThan(0);

    const field = screen.getByLabelText('answer');
    fireEvent.change(field, { target: { value: 'h' } });
    fireEvent.change(field, { target: { value: 'he' } });
    fireEvent.change(field, { target: { value: 'hel' } });

    // Before `memo`, each of those three keystrokes cost another full pass over
    // every card's markdown.
    expect(markdownSpy.mock.calls.length).toBe(mounted);
  });

  it('still re-parses a card whose content actually changed', () => {
    // The memo must be a cache, not a freeze.
    const { rerender } = render(<DeckHarness stack={stack()} />);
    markdownSpy.mockClear();

    const changed = stack();
    changed[1] = makeItem('idea', { sourceId: 'b', body: 'a genuinely new body' });
    rerender(<DeckHarness stack={changed} />);

    expect(markdownSpy).toHaveBeenCalledWith('a genuinely new body');
  });
});

/* ---------------------------------------------------------------------------
 * PAST THE CARD.
 *
 * The harness above proves `TriageCard`'s memo holds — but it renders three
 * cards and nothing else, and it never passes `answerSlot`, which is precisely
 * the case where the memo CANNOT hold: a question card's answer panel is a fresh
 * element on every render of the deck, so the top card is re-rendered by every
 * keystroke by construction.
 *
 * What the deck must not do is rebuild everything AROUND that card as well. Until
 * this file, `TriageCard` was the only memoised component under `deck/`, so a
 * character typed into an answer box re-rendered the top bar and its seven filter
 * chips, the queue rail and one row per queued item, the action bar and one
 * button per branch, and both flanks — none of which can be affected by typing.
 * ------------------------------------------------------------------------ */

const NO_BACKLOG: TriageBacklog = {
  loaded: 0,
  pending: 0,
  hasMore: false,
  remaining: 0,
  capped: [],
  more: false,
};

const SUMMARY = {
  decided: 0,
  accepted: 0,
  skipped: 0,
  undone: 0,
  conflicts: 0,
  medianDwellMs: null,
  byKind: [],
} as unknown as UnifiedTriageQueue['summary'];

function deckQueue(items: ReturnType<typeof makeItem>[]): UnifiedTriageQueue {
  return {
    items,
    allCounts: emptyCounts(),
    loading: false,
    failures: [],
    activeKinds: new Set(ALL_KINDS),
    toggleKind: vi.fn(),
    showAllKinds: vi.fn(),
    decidedCount: 0,
    sessionTotal: items.length,
    deferredCount: 0,
    skips: new Map(),
    focusItem: vi.fn(),
    backlog: NO_BACKLOG,
    loadMore: vi.fn(),
    summary: SUMMARY,
    undo: null,
    undoLast: vi.fn().mockResolvedValue(undefined),
    decide: vi.fn().mockResolvedValue(undefined),
    openLink: vi.fn(),
    reload: vi.fn(),
  };
}

/** A question card plus enough siblings to give the rail real rows. */
const questionDeck = () => [
  makeQuestion({ sourceId: 'sess-1', body: 'the session body' }),
  makeItem('idea', { sourceId: 'q-b', body: 'second card body' }),
  makeItem('review', { sourceId: 'q-c', body: 'third card body', reasoning: 'why' }),
  makeItem('practice', { sourceId: 'q-d', body: 'fourth card body' }),
  makeItem('goal', { sourceId: 'q-e', body: 'fifth card body' }),
];

function renderDeck(items = questionDeck()) {
  const queue = deckQueue(items);
  const view = render(
    <AriaLiveProvider>
      <TriageDeckVariant queue={queue} onClose={vi.fn()} title="Triage" />
    </AriaLiveProvider>,
  );
  return { queue, view };
}

/** Type `n` characters into the top card's answer field. */
function type(n: number) {
  const field = screen.getAllByRole('textbox')[0]!;
  for (let i = 0; i < n; i += 1) {
    fireEvent.change(field, { target: { value: 'x'.repeat(i + 1) } });
  }
}

describe('the deck CHROME does not rebuild on every keystroke', () => {
  it('re-renders only the answer path, not the bar / rail / action bar', () => {
    renderDeck();
    const mounted = renderTick.mock.calls.length;
    // A five-card deck mounts a top bar with seven filter chips, a rail with
    // five rows, three stacked cards and an action bar — a lot to rebuild.
    expect(mounted).toBeGreaterThan(15);

    renderTick.mockClear();
    type(3);

    // Every component that still renders per keystroke is on the answer path:
    // the deck shell, the top card and its panel. The bar, the rail's rows, the
    // action bar and the two cards behind the top one are memoised out.
    const perKeystroke = renderTick.mock.calls.length / 3;
    // eslint-disable-next-line no-console
    console.warn('MEASURED mounted=', mounted, 'perKeystroke=', perKeystroke);
    expect(perKeystroke).toBeLessThanOrEqual(8);
    // Sanity: it is not zero — the answer field genuinely re-rendered.
    expect(perKeystroke).toBeGreaterThan(0);
  });

  it('re-parses NO markdown while typing into a question card', () => {
    // The top card's own body is replaced by `answerSlot`, but the cards behind
    // it and this card's `reasoning`/`evidence` blocks are still markdown, and
    // they were all re-parsed on every character before `CardProse`/`CardBody`
    // were memoised out of the re-render.
    renderDeck();
    markdownSpy.mockClear();
    type(3);
    expect(markdownSpy).not.toHaveBeenCalled();
  });

  it('still rebuilds the chrome when the QUEUE actually changes', () => {
    // The memo must be a cache, not a freeze: a poll that lands a new queue has
    // to reach the rail and the bar.
    const { view } = renderDeck();
    renderTick.mockClear();

    const next = deckQueue([...questionDeck(), makeItem('idea', { sourceId: 'q-f' })]);
    view.rerender(
      <AriaLiveProvider>
        <TriageDeckVariant queue={next} onClose={vi.fn()} title="Triage" />
      </AriaLiveProvider>,
    );

    expect(renderTick.mock.calls.length).toBeGreaterThan(8);
  });
});
