/**
 * The lane hub on the CommandBar, the peek half (ported from the chip hub's
 * test when the chips were deleted at the mandate-lanes cutover, WP10):
 *  - pressing a lane opens its peek and asks the roster only for the chips
 *    that lane needs;
 *  - A on the focused peek row writes through `roster.decide`; R arms, Enter
 *    confirms;
 *  - Enter on a row opens the Decision Deck through its one door, scoped to
 *    the lane, focused on the row, returning to the lane;
 *  - the deck closing with `returnTo` reopens the peek on that row, and a deck
 *    the hub did not open never does;
 *  - a lane whose read failed shows a retry, never an empty band;
 *  - Escape closes the peek and goes no further.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';

import type { DecisionRoster, DecisionRosterOptions } from '../../../useDecisionRoster';
import type { ChipCount, DecisionItem, HubChip } from '../../../model/decisionModel';
import { item } from '../../../__tests__/rosterFixtures';
import { closeDecisionDeck, useDecisionDeckStore } from '../../../deck/deckStore';
import { buildLaneCounts } from '../../../lanes/laneModel';
import { laneEntry } from '../../../mandate/__tests__/mandateFixtures';

const decide = vi.fn<DecisionRoster['decide']>(() => Promise.resolve());
const refresh = vi.fn();
const loads: Array<DecisionRosterOptions['load']> = [];
let gates: DecisionItem[] = [];
let snapshotFailed = false;

const snapshot: DecisionLanesSnapshot = {
  items: [
    laneEntry('review:r1', { lane: 'breach', clause: 'scope' }),
    laneEntry('review:r2', { lane: 'breach', clause: 'scope' }),
  ],
  charters: [{ charterId: 'c1', projectId: 'p1', status: 'active', envelopeVersion: 1, held: 2 }],
  failedSources: [],
  generatedAt: '2026-10-15T09:00:00Z',
};

vi.mock('../../../lanes/useLanesSnapshot', () => ({
  useLanesSnapshot: () => ({ snapshot, failed: snapshotFailed, loading: false }),
  useCharterActRecorded: () => {},
}));

vi.mock('@/features/fleet/monitor/grid/prototype/entry-e/mandate/useMandates', () => ({
  useMandates: () => ({ mandates: null, failed: false, refresh: vi.fn() }),
}));

const chip = (n: number): ChipCount => ({ n, lamp: n > 0 ? 'warning' : 'neutral', failed: false });

vi.mock('../../../useDecisionRoster', () => ({
  useDecisionRoster: (options: DecisionRosterOptions = {}): DecisionRoster => {
    loads.push(options.load);
    const wantsGates = Array.isArray(options.load) && options.load.includes('gates');
    const counts = Object.fromEntries(
      (['gates', 'proposals', 'backlog', 'incidents', 'council', 'reports', 'chat', 'ready'] as HubChip[]).map((c) => [c, chip(0)]),
    ) as Record<HubChip, ChipCount>;
    return {
      counts,
      total: 2,
      items: wantsGates ? gates : [],
      byChip: wantsGates ? { gates } : {},
      errors: {},
      loading: false,
      decide,
      refresh,
      lanes: buildLaneCounts({ snapshot, snapshotFailed, questions: 0, chat: { n: 0, failed: false } }),
      laneTotal: 2,
      lanesSettled: true,
    } as unknown as DecisionRoster;
  },
}));

import { LaneHub } from '../LaneHub';

const originalScrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function mount() {
  gates = [
    item({ id: 'review:r1', kind: 'review', title: 'Ship the parser split?', createdAt: '2026-10-15T08:00:00Z' }),
    item({ id: 'review:r2', kind: 'review', title: 'Rotate the staging key?', createdAt: '2026-10-15T08:30:00Z' }),
  ];
  return render(
    <AppKeyboardProvider>
      <LaneHub />
    </AppKeyboardProvider>,
  );
}

const openBreach = () => fireEvent.click(screen.getByTestId('decision-lane-breach'));

beforeEach(() => {
  useDecisionDeckStore.setState({ request: null, session: 0, closedReturnTo: null });
  snapshotFailed = false;
});

afterEach(() => {
  decide.mockClear();
  refresh.mockClear();
  loads.length = 0;
});

describe('LaneHub peek', () => {
  it('opens a lane\'s peek and loads only the chips that lane needs', () => {
    mount();
    expect(screen.queryByTestId('decision-peek')).toBeNull();
    expect(loads.at(-1)).toEqual([]);
    openBreach();
    expect(screen.getByTestId('decision-peek').getAttribute('data-chip')).toBe('lane-breach');
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('false');
    expect(loads.at(-1)).toEqual(['gates']);
    expect(screen.getByTestId('decision-peek-row-review:r1')).toBeTruthy();
  });

  it('A on the focused row decides it through the roster', () => {
    mount();
    openBreach();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]![0]).toMatchObject({ verdict: 'accept', item: { id: 'review:r2' } });
  });

  it('R arms a reject and Enter confirms it', () => {
    mount();
    openBreach();
    fireEvent.keyDown(window, { key: 'r' });
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByTestId('decision-peek-armed')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(decide.mock.calls[0]![0]).toMatchObject({ verdict: 'reject', item: { id: 'review:r1' } });
    expect(useDecisionDeckStore.getState().request).toBeNull();
  });

  it('Enter opens the deck on the focused row, scoped to the lane, returning to it', () => {
    mount();
    openBreach();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    const request = useDecisionDeckStore.getState().request;
    expect(request).toMatchObject({ scope: { kind: 'lane', lane: 'breach' }, focusId: 'review:r2', returnTo: 'breach' });
    expect(request?.origin).toEqual(expect.objectContaining({ width: expect.any(Number) }));
    // The peek folds away behind the deck.
    expect(screen.queryByTestId('decision-peek')).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it('the deck closing with returnTo reopens the peek on the row it left', () => {
    mount();
    openBreach();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.queryByTestId('decision-peek')).toBeNull();
    act(() => closeDecisionDeck());
    expect(screen.getByTestId('decision-peek').getAttribute('data-chip')).toBe('lane-breach');
    expect(useDecisionDeckStore.getState().closedReturnTo).toBeNull();
    expect(screen.getByTestId('decision-peek-row-review:r2').hasAttribute('data-focused')).toBe(true);
  });

  it('a deck the hub did not open never reopens a peek', () => {
    mount();
    act(() => {
      useDecisionDeckStore.getState().open({ scope: { kind: 'lane', lane: 'breach' }, returnTo: 'breach' });
    });
    act(() => closeDecisionDeck());
    expect(screen.queryByTestId('decision-peek')).toBeNull();
  });

  it('a lane whose read failed shows a retry, never an empty band', () => {
    snapshotFailed = true;
    vi.useFakeTimers();
    try {
      mount();
      gates = [];
      openBreach();
      // The load settles a beat after the lane is asked for (`useLoadSettled`).
      act(() => { vi.advanceTimersByTime(500); });
      const peek = screen.getByTestId('decision-peek');
      expect(within(peek).queryByTestId('decision-peek-empty')).toBeNull();
      fireEvent.click(within(peek).getByRole('button', { name: /retry/i }));
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape closes the peek before anything behind it sees the press', () => {
    mount();
    openBreach();
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

  it('the Ready chip opens its own peek, named Ready', () => {
    mount();
    fireEvent.click(screen.getByTestId('decision-chip-ready'));
    expect(screen.getByTestId('decision-peek').getAttribute('data-chip')).toBe('ready');
    expect(screen.getByTestId('decision-peek-ready')).toBeTruthy();
  });
});
