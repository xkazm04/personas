// The decision stage's keyboard and focus, through the app's real keyboard
// registry: Space sets the item aside only when focus is on the stage itself
// (a focused control takes Space as its own), focus lands on the new item's
// question when one swaps in, stepping the queue is announced, and the queue's
// dots are one tab stop.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { WorkItem } from '../../../useWorkforce';
import { DecisionStage } from './DecisionStage';
import { DeskHead } from './decision/v1/DeskHead';

const announce = vi.fn();
const picked = vi.fn();

vi.mock('@/features/shared/components/feedback/AriaLiveProvider', () => ({ useAnnounce: () => announce }));
vi.mock('./ItemSurface', () => ({
  ItemSurface: ({ item }: { item: WorkItem }) => (
    <section data-fusion-question="" tabIndex={-1} aria-label={`question ${item.id}`}>
      <p>{item.title}</p>
      <button type="button" data-testid="card" onClick={() => picked(item.id)}>
        Answer
      </button>
    </section>
  ),
}));

const ITEMS: WorkItem[] = [
  { id: 'a', kind: 'decision', title: 'First ask', project: null, createdAtMs: 0 },
  { id: 'b', kind: 'approval', title: 'Second ask', project: null, createdAtMs: 0 },
  { id: 'c', kind: 'nudge', title: 'Third ask', project: null, createdAtMs: 0 },
];

function Harness({ children }: { children: ReactNode }) {
  return <AppKeyboardProvider>{children}</AppKeyboardProvider>;
}

function mount(items = ITEMS) {
  const onFocus = vi.fn();
  render(
    <Harness>
      <DecisionStage items={items} focusId={items[0]!.id} onFocus={onFocus} onFold={vi.fn()} onSend={vi.fn()} />
    </Harness>,
  );
  return { onFocus };
}

beforeEach(() => {
  announce.mockClear();
  picked.mockClear();
});
afterEach(cleanup);

describe('Space on the decision stage', () => {
  it('activates a focused card and leaves the item in the queue', async () => {
    mount();
    const user = userEvent.setup();
    screen.getByTestId('card').focus();
    await user.keyboard(' ');
    expect(picked).toHaveBeenCalledWith('a');
    expect(screen.getByText('First ask')).toBeTruthy();
    expect(screen.queryByText('Second ask')).toBeNull();
  });

  it('sets the item aside when focus is on the stage', async () => {
    mount();
    const user = userEvent.setup();
    // The stage focuses the question on mount: not a control, so Space is the stage's.
    expect(document.activeElement?.hasAttribute('data-fusion-question')).toBe(true);
    await user.keyboard(' ');
    await waitFor(() => expect(screen.getByText('Second ask')).toBeTruthy());
    expect(screen.queryByText('First ask')).toBeNull();
    expect(picked).not.toHaveBeenCalled();
  });

  it('moves focus to the new question when an item swaps in', async () => {
    mount();
    const user = userEvent.setup();
    await user.keyboard(' ');
    await waitFor(() => expect(screen.getByText('Second ask')).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByLabelText('question b'));
  });

  it('announces where the queue is, politely, as it steps', async () => {
    mount();
    expect(announce).toHaveBeenCalledWith('1 of 3: First ask');
    const user = userEvent.setup();
    await user.keyboard(' ');
    await waitFor(() => expect(announce).toHaveBeenCalledWith('1 of 2: Second ask'));
  });
});

describe('the queue dots', () => {
  it('are one tab stop, the current one', () => {
    const nav = { items: ITEMS, activeId: 'b', onPick: vi.fn(), onAside: vi.fn(), onFold: vi.fn() };
    act(() => {
      render(
        <Harness>
          <DeskHead item={ITEMS[1]!} model={null} nav={nav} />
        </Harness>,
      );
    });
    const dots = screen.getAllByRole('button').filter((b) => b.classList.contains('d1-dot'));
    expect(dots).toHaveLength(3);
    expect(dots.filter((d) => d.tabIndex === 0)).toHaveLength(1);
    expect(dots[1]!.tabIndex).toBe(0);
  });
});
