/**
 * The deck as one session (mandate-lanes WP1), driven by keys through the
 * real DeckModal:
 *  - an irreversible item ARMS on the first A, shows what leaves, Esc disarms,
 *    and only the second A (or Enter) writes;
 *  - digits pick a reason option while the reason prompt is open;
 *  - I opens and closes every folded section on the card;
 *  - a landed verdict leaves a receipt in the tray;
 *  - an emptied chip deck offers the other chips that still hold cards, and
 *    closes as before when none does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { ChipCount, DecisionItem, HubChip } from '../../model/decisionModel';
import { item } from '../../__tests__/rosterFixtures';
import { DeckModal, offersOf, type DeckSessionSpec } from '../DeckModal';
import { useDecisionDeckStore } from '../deckStore';
import type { DeckLanded, DeckVerdict } from '../deckTypes';

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

const labels = { accept: 'Approve', reject: 'Reject', skip: 'Later' };
const review = (id: string, over: Partial<DecisionItem> = {}) =>
  item({ id, kind: 'review', title: `Review ${id}`, verdictLabels: labels, ...over });

const gates: DeckSessionSpec = { key: 1, scope: { kind: 'chip', chip: 'gates' }, scopeLabel: 'Gates', origin: null, readOnly: false };

function counts(over: Partial<Record<HubChip, number>>): Record<HubChip, ChipCount> {
  const all: HubChip[] = ['gates', 'proposals', 'backlog', 'incidents', 'council', 'reports', 'chat', 'ready'];
  return Object.fromEntries(all.map((c) => [c, { n: over[c] ?? 0, lamp: 'neutral', failed: false }])) as Record<HubChip, ChipCount>;
}

function mount(items: DecisionItem[], opts: { counts?: Record<HubChip, ChipCount>; onBack?: () => void } = {}) {
  const onDecide = vi.fn((_v: DeckVerdict): Promise<DeckLanded | void> => Promise.resolve());
  const onBack = opts.onBack ?? vi.fn();
  const view = (list: DecisionItem[]) => (
    <AppKeyboardProvider>
      <DeckModal session={gates} items={list} loading={false} counts={opts.counts} onDecide={onDecide} onBack={onBack} onOpenLink={() => {}} />
    </AppKeyboardProvider>
  );
  const r = render(view(items));
  return { onDecide, onBack, rerender: (list: DecisionItem[]) => r.rerender(view(list)) };
}

const key = (k: string, code?: string) => fireEvent.keyDown(window, { key: k, code });

afterEach(() => useDecisionDeckStore.setState({ request: null, session: 0, closedReturnTo: null }));

describe('deck session', () => {
  it('an irreversible item arms first, says what leaves, disarms on Esc, and writes on the second press', async () => {
    const { onDecide } = mount([review('review:1', { irreversible: 'outbound-message', title: 'Email the client' })]);
    await screen.findByTestId('deck-card');

    key('a');
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByTestId('deck-armed-box').textContent).toContain('A message leaves this machine and cannot be recalled: Email the client');

    key('Escape');
    expect(screen.queryByTestId('deck-armed-box')).toBeNull();
    expect(onDecide).not.toHaveBeenCalled();

    key('a');
    key('a');
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    expect(onDecide.mock.calls[0]![0]).toMatchObject({ verdict: 'accept' });
  });

  it('Enter confirms an armed valve', async () => {
    const { onDecide } = mount([review('review:1', { irreversible: 'spend' })]);
    await screen.findByTestId('deck-card');
    key('a');
    expect(onDecide).not.toHaveBeenCalled();
    key('Enter');
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'accept' })));
  });

  it('an ordinary item still decides on one press', async () => {
    const { onDecide } = mount([review('review:1'), review('review:2')]);
    await screen.findByTestId('deck-card');
    key('a');
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
  });

  it('a digit picks a reason option while the prompt is open', async () => {
    const prompted = review('review:1', {
      reasonPrompts: [{
        on: 'reject', title: 'Why reject?', skipLabel: 'Skip', freeText: true,
        options: [{ id: 'd', label: 'Duplicate', value: 'duplicate' }, { id: 'o', label: 'Old', value: 'stale' }],
      }],
    });
    const { onDecide } = mount([prompted]);
    await screen.findByTestId('deck-card');
    key('r');
    key('r');
    expect(screen.getByTestId('deck-reason')).toBeTruthy();
    key('2', 'Digit2');
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'reject', reason: 'stale' })));
  });

  it('I opens and closes every folded section on the card', async () => {
    const evidence = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
    mount([review('review:1', { evidence, reasoning: 'Because it matters. '.repeat(30) })]);
    await screen.findByTestId('deck-card');
    const folds = (state: boolean) => document.querySelectorAll('[data-testid^="deck-fold-"] > button[aria-expanded="' + state + '"]');
    const closed = () => folds(false);
    expect(closed()).toHaveLength(2);
    expect(screen.getByTestId('deck-fold-evidence').textContent).toContain('12 lines · line 1');

    key('i');
    expect(closed()).toHaveLength(0);
    expect(screen.getByText(/line 12/)).toBeTruthy();
    key('I');
    expect(closed()).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Evidence/ }));
    expect(folds(true)).toHaveLength(1);
  });

  it('a landed verdict leaves a receipt in the tray', async () => {
    mount([review('review:1'), review('review:2')]);
    await screen.findByTestId('deck-card');
    expect(screen.getByTestId('deck-receipt').textContent).toBe('');
    key('a');
    await waitFor(() => expect(screen.getByTestId('deck-receipt').textContent).toBe('Accepted: Review review:1'));
  });

  it('a verdict queued for another device leaves the host receipt, not "Accepted"', async () => {
    const { onDecide } = mount([review('review:1'), review('review:2')]);
    onDecide.mockImplementation(() => Promise.resolve({ receipt: 'Queued until Desk wakes: Review review:1' }));
    await screen.findByTestId('deck-card');
    key('a');
    await waitFor(() => expect(screen.getByTestId('deck-receipt').textContent).toBe('Queued until Desk wakes: Review review:1'));
  });

  it('an emptied chip deck offers the other chips that hold cards, and a digit opens one', async () => {
    const onBack = vi.fn();
    const { onDecide, rerender } = mount([review('review:1')], { counts: counts({ gates: 1, backlog: 3 }), onBack });
    await screen.findByTestId('deck-card');
    key('a');
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
    rerender([]);
    const offers = await screen.findByTestId('deck-empty-offers');
    expect(offers.textContent).toContain('Backlog');
    expect(offers.textContent).not.toContain('Council');
    expect(onBack).not.toHaveBeenCalled();
    act(() => { key('1', 'Digit1'); });
    expect(useDecisionDeckStore.getState().request?.scope).toEqual({ kind: 'chip', chip: 'backlog' });
  });

  it('closes as before when no other chip holds cards', async () => {
    const onBack = vi.fn();
    const { rerender } = mount([review('review:1')], { counts: counts({ gates: 1 }), onBack });
    await screen.findByTestId('deck-card');
    key('a');
    rerender([]);
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  });
});

describe('offersOf', () => {
  it('offers other chips with landed, non-zero counts, and nothing for an all deck or without counts', () => {
    const c = counts({ gates: 2, backlog: 1, reports: 4 });
    c.chat = { n: 5, lamp: 'neutral', failed: true };
    expect(offersOf({ kind: 'chip', chip: 'gates' }, c)).toEqual([{ chip: 'backlog', n: 1 }, { chip: 'reports', n: 4 }]);
    expect(offersOf({ kind: 'all' }, c)).toEqual([]);
    expect(offersOf({ kind: 'chip', chip: 'gates' }, undefined)).toEqual([]);
  });
});
