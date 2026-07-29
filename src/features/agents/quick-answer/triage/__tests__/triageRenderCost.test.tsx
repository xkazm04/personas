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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCallback, useState } from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

const markdownSpy = vi.fn();

vi.mock('@/features/shared/components/editors/MarkdownRenderer', () => ({
  MarkdownRenderer: (props: { content: string }) => {
    markdownSpy(props.content);
    return <div data-testid="markdown">{props.content}</div>;
  },
}));

import { TriageCard, type FlingDirection } from '../deck/TriageCard';
import { makeItem } from './triageFixtures';

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

beforeEach(() => markdownSpy.mockClear());

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
