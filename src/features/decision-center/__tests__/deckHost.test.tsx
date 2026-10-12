/**
 * The live Decision Deck (decision-center wave 3, C1a):
 *  - the host renders nothing until a request, opens on it, and closes;
 *  - the request's scope sets what the roster loads and which cards are dealt
 *    (chip / all / single), and `focusId` picks the opening card;
 *  - a read-only single card has no verdict dock, only Close;
 *  - a write the roster rejects keeps the card in hand and toasts;
 *  - a council send-back will not go out under 12 characters of reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { DecisionRoster, DecisionRosterOptions } from '../useDecisionRoster';
import type { DecisionItem } from '../model/decisionModel';
import { item } from './rosterFixtures';

const decide = vi.fn<DecisionRoster['decide']>(() => Promise.resolve());
const loads: Array<DecisionRosterOptions['load']> = [];
let items: DecisionItem[] = [];

vi.mock('../useDecisionRoster', () => ({
  useDecisionRoster: (options: DecisionRosterOptions = {}): Partial<DecisionRoster> => {
    if (options.enabled) loads.push(options.load);
    return { items: options.enabled ? items : [], byChip: {}, errors: {}, loading: false, decide, refresh: vi.fn() };
  },
}));

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

const toastCatch = vi.fn((_context: string, _message?: string) => vi.fn());
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: (context: string, message?: string) => toastCatch(context, message),
}));

import DecisionDeckHost from '../deck/DecisionDeckHost';
import { closeDecisionDeck, openDecisionDeck, useDecisionDeckStore } from '../deck/deckStore';
import { queueOf } from '../deck/useDeck';

const review = (id: string, over: Partial<DecisionItem> = {}) =>
  item({ id, kind: 'review', title: `Review ${id}`, verdictLabels: { accept: 'Approve', reject: 'Reject', skip: 'Later' }, ...over });

const council = item({
  id: 'council:cs-1',
  kind: 'council',
  title: 'Event bus redesign',
  document: { format: 'markdown', content: '# Verdict\n\nReady.' },
  verdictLabels: { accept: 'Approve', reject: 'Send back', skip: 'Later' },
  reasonPrompts: [{ on: 'reject', title: 'Why reject this round?', options: [], skipLabel: 'Back', freeText: true }],
  payload: { runId: 'run-2', sawDigest: 'd-1', isLatest: 'true', reasonMin: '12' },
});

function mount() {
  return render(<AppKeyboardProvider><DecisionDeckHost /></AppKeyboardProvider>);
}

const shownItem = () => screen.getByTestId('deck-card').getAttribute('data-item');

beforeEach(() => {
  useDecisionDeckStore.setState({ request: null, session: 0, closedReturnTo: null });
  items = [review('review:1'), review('review:2'), item({ id: 'idea:1', kind: 'idea', title: 'An idea' })];
});
afterEach(() => {
  decide.mockReset();
  decide.mockImplementation(() => Promise.resolve());
  toastCatch.mockClear();
  loads.length = 0;
});

describe('queueOf', () => {
  it('deals a chip, everything, or the single item it was handed', () => {
    expect(queueOf({ kind: 'chip', chip: 'gates' }, items).map((x) => x.id)).toEqual(['review:1', 'review:2']);
    expect(queueOf({ kind: 'all' }, items).map((x) => x.id)).toEqual(['review:1', 'review:2', 'idea:1']);
    const one = review('review:9');
    expect(queueOf({ kind: 'single', item: one }, items)).toEqual([one]);
  });
});

describe('DecisionDeckHost', () => {
  it('renders nothing until a request, opens on it, and closes', async () => {
    mount();
    expect(screen.queryByTestId('decision-deck')).toBeNull();
    expect(loads).toEqual([]);

    act(() => openDecisionDeck({ scope: { kind: 'chip', chip: 'gates' }, returnTo: 'gates' }));
    await waitFor(() => expect(shownItem()).toBe('review:1'));
    expect(loads).toContainEqual(['gates']);

    fireEvent.click(screen.getByTestId('decision-deck-close'));
    expect(useDecisionDeckStore.getState().request).toBeNull();
    expect(useDecisionDeckStore.getState().closedReturnTo?.chip).toBe('gates');
    await waitFor(() => expect(screen.queryByTestId('decision-deck')).toBeNull());
  });

  it('opens Triage all over every chip, on the focused card', async () => {
    mount();
    act(() => openDecisionDeck({ scope: { kind: 'all' }, focusId: 'idea:1' }));
    await waitFor(() => expect(shownItem()).toBe('idea:1'));
    expect(loads).toContainEqual('all');
  });

  it('opens on the first card when the focused one never arrives', async () => {
    mount();
    act(() => openDecisionDeck({ scope: { kind: 'chip', chip: 'gates' }, focusId: 'review:gone' }));
    await waitFor(() => expect(shownItem()).toBe('review:1'), { timeout: 2000 });
  });

  it('deals a single item without loading any chip; read-only hides the dock', async () => {
    mount();
    const one = review('review:history');
    act(() => openDecisionDeck({ scope: { kind: 'single', item: one, readOnly: true } }));
    await waitFor(() => expect(shownItem()).toBe('review:history'));
    expect(loads.every((l) => l === undefined)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.keyDown(window, { key: 'a' });
    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('deck-readonly-close'));
    expect(useDecisionDeckStore.getState().request).toBeNull();
  });

  it('a rejected write keeps the card in hand and toasts', async () => {
    decide.mockImplementation(() => Promise.reject(new Error('disk full')));
    mount();
    act(() => openDecisionDeck({ scope: { kind: 'chip', chip: 'gates' } }));
    await waitFor(() => expect(shownItem()).toBe('review:1'));

    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(decide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'accept' })));
    expect(decide.mock.calls[0]![0].item.id).toBe('review:1');
    await waitFor(() => expect(toastCatch).toHaveBeenCalledWith('decision-deck:decide', undefined));
    await waitFor(() => expect(shownItem()).toBe('review:1'));
    expect(useDecisionDeckStore.getState().request).not.toBeNull();
  });

  it('Escape disarms first, then closes only the deck, and consumes the press', async () => {
    mount();
    act(() => openDecisionDeck({ scope: { kind: 'chip', chip: 'gates' }, returnTo: 'gates' }));
    await waitFor(() => expect(shownItem()).toBe('review:1'));

    fireEvent.keyDown(window, { key: 'r' });
    expect(document.querySelector('[data-armed]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDecisionDeckStore.getState().request).not.toBeNull();
    expect(document.querySelector('[data-armed]')).toBeNull();

    // The Monitor behind the deck closes on its own raw window Escape listener,
    // registered after the app's keyboard provider. A press the deck stops
    // immediately never reaches it (DOM order: later window listeners are skipped).
    const press = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stop = vi.spyOn(press, 'stopImmediatePropagation');
    act(() => { window.dispatchEvent(press); });
    expect(stop).toHaveBeenCalled();
    expect(press.defaultPrevented).toBe(true);
    expect(useDecisionDeckStore.getState().request).toBeNull();
    expect(useDecisionDeckStore.getState().closedReturnTo?.chip).toBe('gates');
  });

  it('a council send-back needs 12 characters of reason', async () => {
    mount();
    act(() => openDecisionDeck({ scope: { kind: 'single', item: council } }));
    await waitFor(() => expect(shownItem()).toBe('council:cs-1'));

    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: 'r' });
    const field = await screen.findByRole('textbox', { name: 'Why reject this round?' });
    fireEvent.change(field, { target: { value: 'too short' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(decide).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'The coverage claim is unsupported.' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(decide).toHaveBeenCalledWith(expect.objectContaining({
      verdict: 'reject', reason: 'The coverage claim is unsupported.',
    })));
  });
});

afterEach(() => {
  act(() => closeDecisionDeck());
});
