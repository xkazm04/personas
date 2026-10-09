import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import en from '@/i18n/locales/en.json';

// The Overseer's goal on Layer 1 and his marks on the rail: the strip's open
// item chips (they open the item in place), the fold with every item in the
// reader's order and its state in words, the strip folded for a goal whose
// items are all closed, no strip without a goal; a badge on the cards of the
// steps he owes an item, and the item in that card's peek.

const getIdea = vi.hoisted(() => vi.fn());

vi.mock('@/api/devTools/devTools', () => ({ getIdea }));
vi.mock('../../layer2/stepChunks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer2/stepChunks')>()),
  prefetchStepChunksOnIdle: () => () => {},
}));
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import { healthyMix } from '../../../journey/__tests__/fixtures';
import { overseerGoal, withOverseerGoal } from '../../../journey/__tests__/overseerFixtures';
import { Layer1 } from '../../layer1/Layer1';
import { renderLayer1 } from '../../layer1/__tests__/renderLayer1';
import { PEEK_DELAY_MS } from '../../layer1/rail/usePeek';
import { __resetGoalFoldsForTests } from '../GoalPanel';

const dl = en.plugins.dev_lifecycle;

beforeEach(() => {
  vi.clearAllMocks();
  __resetGoalFoldsForTests();
  getIdea.mockReturnValue(new Promise(() => {}));
});

describe('the goal strip', () => {
  it('shows what he owes as chips, the goal drawn, and counts the rest', () => {
    renderLayer1(<Layer1 />, withOverseerGoal());
    const strip = screen.getByTestId('lc9-goal-panel');
    expect(strip.textContent).toContain(dl.lcx9_goal_name);
    const chips = [...within(strip).getByTestId('lc9-goal-chips').querySelectorAll('[data-testid^="lc9-goal-chip-"]')];
    expect(chips.map((c) => c.getAttribute('data-state'))).toEqual(['regressed', 'accepted']);
    expect(within(strip).getByTestId('lc1-goal').textContent).toContain('3 of 8 measurable steps green');
    expect(within(strip).getByTestId('lc9-goal-tally').textContent).toBe('3 closed · 1 set aside');
    expect(strip.getAttribute('data-open')).toBe('false');
  });

  it('opens an item in place from its chip', async () => {
    renderLayer1(<Layer1 />, withOverseerGoal());
    fireEvent.click(screen.getByTestId('lc9-goal-chip-idea-ov-gate'));
    await waitFor(() => expect(getIdea).toHaveBeenCalledWith('idea-ov-gate'));
  });

  it('unfolds every item, owed first, each in step order, with what happened to it', async () => {
    renderLayer1(<Layer1 />, withOverseerGoal());
    const toggle = screen.getByTestId('lc9-goal-toggle');
    expect(toggle.textContent).toContain('All 6 items');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const list = await screen.findByTestId('lc9-goal-items');
    const rows = [...list.querySelectorAll('[data-testid^="lc9-goal-item-"]')];
    expect(rows.map((r) => r.getAttribute('data-testid')!.replace('lc9-goal-item-idea-ov-', ''))).toEqual(
      ['gate', 'tests', 'isolate', 'commit', 'land', 'record'],
    );
    const row = (id: string) => within(list).getByTestId(`lc9-goal-item-idea-ov-${id}`);
    expect(row('gate').querySelector('[data-status="regressed"]')?.textContent).toBe(dl.lcx9_item_regressed);
    expect(row('gate').querySelector('[data-when]')?.textContent).toMatch(/^Reopened /);
    expect(row('land').querySelector('[data-when]')?.textContent).toMatch(/^Closed by Measure /);
    expect(row('tests').querySelector('[data-status="accepted"]')).toBeTruthy();
    expect(row('commit').querySelector('[data-status="rejected"]')).toBeTruthy();
    expect(row('tests').querySelector('[data-step="tests"]')?.textContent).toBe('Tests');
  });

  it('counts the open items in words when there are no chips to show them', () => {
    const goal = overseerGoal({ items: overseerGoal().items.filter((i) => i.status !== 'accepted'), openItems: 0 });
    renderLayer1(<Layer1 />, healthyMix({ goal }));
    expect(screen.queryByTestId('lc9-goal-chips')).toBeNull();
    expect(screen.getByTestId('lc9-goal-tally').textContent).toBe('3 closed · 1 set aside');
    expect(screen.getByTestId('lc9-goal-panel').getAttribute('data-open')).toBe('false');
  });

  it('draws no strip without a goal', () => {
    renderLayer1(<Layer1 />, healthyMix({ goal: null }));
    expect(screen.queryByTestId('lc9-goal-panel')).toBeNull();
  });
});

describe("the Overseer's marks on the rail", () => {
  it('badges the cards of the steps he owes an item, and no other', () => {
    renderLayer1(<Layer1 />, withOverseerGoal());
    const badged = [...document.querySelectorAll('[data-testid^="lc9-overseer-badge-"]')]
      .map((b) => b.getAttribute('data-testid')!.replace('lc9-overseer-badge-', ''));
    expect(badged).toEqual(['gate', 'tests']);
    expect(screen.getByTestId('lc9-overseer-badge-tests').getAttribute('aria-label')).toBe(dl.lcx9_badge_tip);
    expect(screen.getByTestId('lc9-overseer-badge-gate').getAttribute('aria-label')).toBe(dl.lcx9_badge_tip_regressed);
  });

  it("lists the item in that card's peek", () => {
    vi.useFakeTimers();
    try {
      renderLayer1(<Layer1 />, withOverseerGoal());
      const card = document.querySelector<HTMLElement>('[data-card="tests"]')!;
      fireEvent.pointerEnter(card);
      act(() => { vi.advanceTimersByTime(PEEK_DELAY_MS + 10); });
      const peek = screen.getByTestId('lc9-peek-overseer');
      expect(peek.textContent).toContain('Turn lifecycle step `tests` green (measured amber)');
      expect(peek.querySelector('[data-item="idea-ov-tests"]')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
