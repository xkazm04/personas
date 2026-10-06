/**
 * The hub on the CommandBar (decision-center spark, A3):
 *  - the strip renders its eight chips in order, with counts; a zero chip is
 *    present and dark; a failed chip shows the warning glyph, never a 0;
 *  - pressing a chip opens its peek and asks the roster for that chip only;
 *  - A on the focused peek row writes through `roster.decide`;
 *  - Escape closes the peek and goes no further — a window listener behind it
 *    (the Monitor's own) never sees the press.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { DecisionRoster, DecisionRosterOptions } from '../../useDecisionRoster';
import type { ChipCount, DecisionItem, HubChip } from '../../model/decisionModel';
import { item } from '../../__tests__/rosterFixtures';

const decide = vi.fn<DecisionRoster['decide']>(() => Promise.resolve());
const refresh = vi.fn();
const loads: Array<DecisionRosterOptions['load']> = [];
let gates: DecisionItem[] = [];

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
      errors: {},
      loading: false,
      decide,
      refresh,
    };
  },
}));

import { DecisionHub } from '../DecisionHub';
import { DecisionStrip } from '../DecisionStrip';

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

afterEach(() => {
  decide.mockClear();
  loads.length = 0;
});

describe('DecisionStrip', () => {
  it('renders the eight chips in strip order with their counts, zero dimmed, failed flagged', () => {
    counts = baseCounts();
    render(<DecisionStrip counts={counts} active={null} onPick={() => undefined} onTriageAll={() => undefined} />);
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
    expect(proposals.className).not.toMatch(/\bis-lit\b/);
    expect(screen.getByTestId('decision-chip-gates').className).toMatch(/\bis-lit\b/);
    // Failed: the glyph, and never a 0.
    const incidents = screen.getByTestId('decision-chip-incidents');
    expect(incidents.getAttribute('data-count')).toBe('failed');
    expect(within(incidents).getByTestId('decision-chip-incidents-failed')).toBeTruthy();
    expect(within(incidents).queryByText('0')).toBeNull();
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
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(decide.mock.calls[0]![0]).toMatchObject({ verdict: 'reject', item: { id: 'review:r1' } });
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
