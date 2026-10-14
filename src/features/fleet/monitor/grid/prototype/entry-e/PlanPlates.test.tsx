// PlanPlates - one row per plan, two bars, everything else behind a press.
// The contract is that the row carries NO words (name, percent, countdown) and
// that the popup is where they went.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { buildResourceModel } from '../../usage/useResourceModel';
import { buildSimAccountsSnapshot, buildSimCliUsage } from '../../simulation/simPlans';
import type { UsageFeed } from '../useUsageFeed';
import { PlanPlates } from './PlanPlates';

const NOW = 1_800_000_000_000;

function feed(over: Partial<UsageFeed> = {}): UsageFeed {
  const snapshot = buildSimAccountsSnapshot(NOW);
  return {
    model: buildResourceModel({ accounts: snapshot, single: null, cli: buildSimCliUsage(NOW), fetchedAt: NOW, now: NOW }),
    now: NOW, snapshot, planCount: snapshot.accounts.length,
    autoRotate: snapshot.autoRotate, saveAutoRotate: vi.fn(),
    fetchedAt: NOW, refresh: vi.fn(() => Promise.resolve()), canRefresh: true, refreshHint: 'Refresh',
    ask: vi.fn(), dialog: null,
    ...over,
  } as UsageFeed;
}

describe('PlanPlates', () => {
  it('paints one row per stored plan and one per metered CLI, with no header per provider', () => {
    render(<PlanPlates usage={feed()} />);
    const rows = screen.getAllByTestId('entry-e-plan');
    const stored = buildSimAccountsSnapshot(NOW).accounts.length;
    expect(rows).toHaveLength(stored + 3); // + codex + agy's two model groups (grok is not installed: a worded row, not a plan)
    expect(screen.getByTestId('entry-e-provider-grok')).toBeTruthy();
  });

  it('keeps the metadata out of the row and behind a press', () => {
    const usage = feed();
    render(<PlanPlates usage={usage} />);
    const row = screen.getAllByTestId('entry-e-plan')[0]!;
    expect(row.textContent).toBe('');
    expect(screen.queryByTestId('entry-e-plan-popover')).toBeNull();

    fireEvent.click(row);
    const pop = screen.getByTestId('entry-e-plan-popover');
    expect(within(pop).getAllByTestId('entry-e-plan-window').length).toBeGreaterThanOrEqual(2);
    expect(within(pop).getByTestId('fleet-usage-rotate-threshold')).toBeTruthy();

    fireEvent.click(row);
    expect(screen.queryByTestId('entry-e-plan-popover')).toBeNull();
  });

  it('asks to switch from the popup of a standby plan and closes it', () => {
    const usage = feed();
    render(<PlanPlates usage={usage} />);
    const standby = screen.getAllByTestId('entry-e-plan').find((r) => r.getAttribute('data-active') === null)!;
    fireEvent.click(standby);
    const pop = screen.getByTestId('entry-e-plan-popover');
    const sw = within(pop).queryAllByRole('button').find((b) => b.getAttribute('aria-label')?.includes('simulated.test'));
    expect(sw).toBeTruthy();
    fireEvent.click(sw!);
    expect(usage.ask).toHaveBeenCalledWith('switch', expect.objectContaining({ canSwitch: true }));
    expect(screen.queryByTestId('entry-e-plan-popover')).toBeNull();
  });
});
