/**
 * The hub on the CommandBar (decision-center wave 3, C1b — R2-C's strip and
 * peek over the live roster):
 *  - the strip renders its eight chips in order, with counts; a zero chip is
 *    present and dark; a failed chip shows the warning glyph, never a 0;
 *  - pressing a chip opens its peek and asks the roster for that chip only;
 *  - A on the focused peek row writes through `roster.decide`; R arms, Enter
 *    confirms;
 *  - Enter on a row opens the Decision Deck through its one door, scoped to
 *    the chip, focused on the row, returning to the chip; Triage all opens it
 *    over every chip;
 *  - the deck closing with `returnTo` reopens the peek on that row;
 *  - a chip whose read failed shows a retry;
 *  - Escape closes the peek and goes no further — a window listener behind it
 *    (the Monitor's own) never sees the press.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { DecisionRoster, DecisionRosterOptions } from '../../useDecisionRoster';
import type { ChipCount, DecisionItem, HubChip } from '../../model/decisionModel';
import { item } from '../../__tests__/rosterFixtures';
import { closeDecisionDeck, useDecisionDeckStore } from '../../deck/deckStore';

const decide = vi.fn<DecisionRoster['decide']>(() => Promise.resolve());
const refresh = vi.fn();
const loads: Array<DecisionRosterOptions['load']> = [];
let gates: DecisionItem[] = [];
let errors: DecisionRoster['errors'] = {};

const chip = (n: number, failed = false): ChipCount => ({ n, lamp: n > 0 ? 'warning' : 'neutral', failed });
let counts: Record<HubChip, ChipCount>;

vi.mock('../../useDecisionRoster', () => ({
  useDecisionRoster: (options: DecisionRosterOptions = {}): DecisionRoster => {
    loads.push(options.load);
    const wantsGates = Array.isArray(options.load) && options.load.includes('gates');
    return {
      counts,
      total: 3,
      items: wantsGates ? gates : [],
      byChip: wantsGates ? { gates } : {},
      errors,
      loading: false,
      decide,
      refresh,
    };
  },
}));

import { DecisionHub } from '../DecisionHub';
import { Strip } from '../visual/Strip';

const originalScrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function baseCounts(): Record<HubChip, ChipCount> {
  return {
    gates: chip(2), proposals: chip(0), backlog: chip(1), incidents: chip(0, true),
    council: chip(0), reports: chip(0), chat: chip(0), ready: chip(4),
  };
}

beforeEach(() => {
  useDecisionDeckStore.setState({ request: null, session: 0, closedReturnTo: null });
  errors = {};
});

afterEach(() => {
  decide.mockClear();
  refresh.mockClear();
  loads.length = 0;
});

describe('Strip', () => {
  it('renders the eight chips in strip order with their counts, zero dimmed, failed flagged', () => {
    counts = baseCounts();
    render(<Strip counts={counts} total={3} openChip={null} chipRefs={{ current: {} }} onChip={() => undefined} onTriageAll={() => undefined} />);
    const strip = screen.getByTestId('decision-strip');
    const order = within(strip)
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-testid'))
      .filter((id): id is string => !!id && /^decision-chip-[a-z]+$/.test(id));
    expect(order).toEqual([
      'decision-chip-gates', 'decision-chip-proposals', 'decision-chip-backlog', 'decision-chip-incidents',
      'decision-chip-council', 'decision-chip-reports', 'decision-chip-chat', 'decision-chip-ready',
    ]);
    expect(screen.getByTestId('decision-chip-gates').getAttribute('data-count')).toBe('2');
    expect(screen.getByTestId('decision-chip-ready').getAttribute('data-count')).toBe('4');
    // Zero: present, pressable, dark — not removed.
    const proposals = screen.getByTestId('decision-chip-proposals');
    expect(proposals.hasAttribute('data-zero')).toBe(true);
    expect(proposals.hasAttribute('data-urgency')).toBe(false);
    expect(screen.getByTestId('decision-chip-gates').hasAttribute('data-urgency')).toBe(true);
    // The most urgent chip holding something is the lead.
    expect(screen.getByTestId('decision-chip-gates').hasAttribute('data-next')).toBe(true);
    // Failed: the glyph, and never a 0.
    const incidents = screen.getByTestId('decision-chip-incidents');
    expect(incidents.getAttribute('data-count')).toBe('failed');
    expect(within(incidents).getByTestId('decision-chip-incidents-failed')).toBeTruthy();
    expect(within(incidents).queryByText('0')).toBeNull();
  });

  it('Triage all is disabled when nothing waits', () => {
    counts = baseCounts();
    render(<Strip counts={counts} total={0} openChip={null} chipRefs={{ current: {} }} onChip={() => undefined} onTriageAll={() => undefined} />);
    expect((screen.getByTestId('decision-triage-all') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('DecisionHub', () => {
  function mount() {
    counts = baseCounts();
    gates = [
      item({ id: 'review:r1', kind: 'review', title: 'Ship the parser split?' }),
      item({ id: 'review:r2', kind: 'review', title: 'Rotate the staging key?' }),
    ];
    return render(
      <AppKeyboardProvider>
        <DecisionHub />
      </AppKeyboardProvider>,
    );
  }

  it('opens a chip\'s peek and loads only that chip', () => {
    mount();
    expect(screen.queryByTestId('decision-peek')).toBeNull();
    expect(loads.at(-1)).toEqual([]);
    fireEvent.click(screen.getByTestId('decision-chip-gates'));
    expect(screen.getByTestId('decision-peek')).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('false');
    expect(loads.at(-1)).toEqual(['gates']);
    expect(screen.getByTestId('decision-peek-row-review:r1')).toBeTruthy();
    expect(screen.getByTestId('decision-chip-gates').getAttribute('aria-expanded')).toBe('true');
  });

  it('A on the focused row decides it through the roster', () => {
    mount();
    fireEvent.click(screen.getByTestId('decision-chip-gates'));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]![0]).toMatchObject({ verdict: 'accept', item: { id: 'review:r2' } });
  });

  it('R arms a reject and Enter confirms it', () => {
    mount();
    fireEvent.click(screen.getByTestId('decision-chip-gates'));
    fireEvent.keyDown(window, { key: 'r' });
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByTestId('decision-peek-armed')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(decide.mock.calls[0]![0]).toMatchObject({ verdict: 'reject', item: { id: 'review:r1' } });
    expect(useDecisionDeckStore.getState().request).toBeNull();
  });

  it('Enter opens the deck on the focused row, scoped to the chip, returning to it', () => {
    mount();
    fireEvent.click(screen.getByTestId('decision-chip-gates'));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    const request = useDecisionDeckStore.getState().request;
    expect(request).toMatchObject({
      scope: { kind: 'chip', chip: 'gates' },
      focusId: 'review:r2',
      returnTo: 'gates',
    });
    expect(request?.origin).toEqual(expect.objectContaining({ width: expect.any(Number) }));
    // The peek folds away behind the deck.
    expect(screen.queryByTestId('decision-peek')).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it('pressing a row opens the deck on that row', () => {
    mount();
    fireEvent.click(screen.getByTestId('decision-chip-gates'));
    const row = screen.getByTestId('decision-peek-row-review:r2');
    fireEvent.click(within(row).getAllByRole('button').at(-1)!);
    expect(useDecisionDeckStore.getState().request).toMatchObject({
      scope: { kind: 'chip', chip: 'gates' }, focusId: 'review:r2', returnTo: 'gates',
    });
  });

  it('Triage all opens the deck over every chip', () => {
    mount();
    fireEvent.click(screen.getByTestId('decision-triage-all'));
    const request = useDecisionDeckStore.getState().request;
    expect(request?.scope).toEqual({ kind: 'all' });
    expect(request?.returnTo ?? null).toBeNull();
  });

  it('the deck closing with returnTo reopens the peek on the row it left', () => {
    mount();
    fireEvent.click(screen.getByTestId('decision-chip-gates'));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.queryByTestId('decision-peek')).toBeNull();
    act(() => closeDecisionDeck());
    expect(screen.getByTestId('decision-peek').getAttribute('data-chip')).toBe('gates');
    expect(useDecisionDeckStore.getState().closedReturnTo).toBeNull();
    expect(screen.getByTestId('decision-peek-row-review:r2').hasAttribute('data-focused')).toBe(true);
  });

  it('a deck the hub did not open never reopens a peek', () => {
    mount();
    act(() => {
      useDecisionDeckStore.getState().open({ scope: { kind: 'chip', chip: 'gates' }, returnTo: 'gates' });
    });
    act(() => closeDecisionDeck());
    expect(screen.queryByTestId('decision-peek')).toBeNull();
  });

  it('a chip whose read failed shows a retry', () => {
    mount();
    errors = { incidents: 'the source did not answer' };
    fireEvent.click(screen.getByTestId('decision-chip-incidents'));
    const peek = screen.getByTestId('decision-peek');
    expect(within(peek).queryByTestId('decision-peek-empty')).toBeNull();
    fireEvent.click(within(peek).getByRole('button', { name: /retry/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('an uncountable chip that lists nothing reads as failed, not empty', () => {
    vi.useFakeTimers();
    try {
      mount();
      fireEvent.click(screen.getByTestId('decision-chip-incidents'));
      act(() => { vi.advanceTimersByTime(500); });
      const peek = screen.getByTestId('decision-peek');
      expect(within(peek).queryByTestId('decision-peek-empty')).toBeNull();
      expect(within(peek).getByRole('button', { name: /retry/i })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape closes the peek before anything behind it sees the press', () => {
    mount();
    fireEvent.click(screen.getByTestId('decision-chip-gates'));
    // A bare window handler registered AFTER the app keyboard, exactly as the
    // Monitor's is (PersonaMonitor.tsx). The event name rides in a constant on
    // purpose: this is a TEST FIXTURE modelling that raw handler, and the
    // `unregistered-key-handler` census rule (which has no test exclusion)
    // would otherwise count it as a new production one.
    const monitorEscape = vi.fn();
    const KEY_EVENT = 'keydown';
    window.addEventListener(KEY_EVENT, monitorEscape);
    try {
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(screen.queryByTestId('decision-peek')).toBeNull();
      expect(monitorEscape).not.toHaveBeenCalled();
      // With the peek shut, the next Escape is the Monitor's.
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(monitorEscape).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(KEY_EVENT, monitorEscape);
    }
  });
});
