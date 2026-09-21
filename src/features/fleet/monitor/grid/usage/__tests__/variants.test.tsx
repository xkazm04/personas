// One render per variant against the simulation fixture. Each asserts the things
// every layout owes regardless of its shape: all three providers are named, a
// provider with nothing to meter says so in words, the read-only provider wears
// its age, the Claude acts survive behind the classic confirm, and the budgets
// block states the one hold reason (and is absent when the snapshot has none).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { ComponentType } from 'react';

const { setAppSetting, useAppSettingMock } = vi.hoisted(() => ({
  setAppSetting: vi.fn(),
  useAppSettingMock: vi.fn(),
}));
vi.mock('@/api/system/settings', () => ({ setAppSetting, deleteAppSetting: vi.fn() }));
vi.mock('@/hooks/utility/data/useAppSetting', () => ({ useAppSetting: useAppSettingMock }));

import { buildResourceModel } from '../useResourceModel';
import { buildSimAccountsSnapshot, buildSimBudgets, buildSimCliUsage } from '../../simulation/simPlans';
import type { UsageVariantProps } from '../variants/variantBits';
import { LanesStrip } from '../variants/LanesStrip';
import { HorizonStrip, horizonX } from '../variants/HorizonStrip';
import { CockpitStrip } from '../variants/CockpitStrip';
import { LedgerStrip } from '../variants/LedgerStrip';

const NOW = Date.now();

function simModel(withBudgets = true) {
  return buildResourceModel({
    accounts: buildSimAccountsSnapshot(NOW),
    single: null,
    cli: buildSimCliUsage(NOW),
    budgets: withBudgets ? buildSimBudgets() : undefined,
    fetchedAt: NOW,
    now: NOW,
  });
}

const VARIANTS: Array<[string, ComponentType<UsageVariantProps>, string]> = [
  ['lanes', LanesStrip, 'fleet-usage-lanes'],
  ['horizon', HorizonStrip, 'fleet-usage-horizon'],
  ['cockpit', CockpitStrip, 'fleet-usage-cockpit'],
  ['ledger', LedgerStrip, 'fleet-usage-ledger'],
];

beforeEach(() => {
  useAppSettingMock.mockReset().mockReturnValue({
    value: 'true', setValue: vi.fn(), save: vi.fn(), loaded: true, saved: false, error: null,
  });
});

describe.each(VARIANTS)('%s variant', (_name, View, rootId) => {
  const onSwitch = vi.fn().mockResolvedValue(undefined);
  const onRemove = vi.fn().mockResolvedValue(undefined);

  it('names all three providers, words the empty one, and states the budget hold', () => {
    render(<View model={simModel()} onSwitch={onSwitch} onRemove={onRemove} simulated />);
    const root = screen.getByTestId(rootId);
    for (const name of ['Claude', 'Codex', 'Grok']) {
      expect(within(root).getAllByText(name).length).toBeGreaterThan(0);
    }
    const empty = within(root).getByTestId('fleet-usage-empty');
    expect(empty).toHaveAttribute('data-reason', 'not_installed');
    expect(empty).toHaveTextContent('Not installed');

    const hold = within(root).getByTestId('fleet-budgets-hold');
    expect(hold).toHaveAttribute('data-hold', 'ahead_of_pace');
    expect(hold).toHaveTextContent('ahead of plan pace');
  });

  it('labels the read-only provider with how old its numbers are', () => {
    render(<View model={simModel()} onSwitch={onSwitch} onRemove={onRemove} simulated />);
    const fresh = within(screen.getByTestId(rootId)).getAllByTestId('fleet-usage-freshness');
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh[0]).toHaveTextContent('reported');
  });

  it('keeps the Claude plan acts, behind the classic confirm', () => {
    render(<View model={simModel()} onSwitch={onSwitch} onRemove={onRemove} simulated />);
    const root = screen.getByTestId(rootId);
    // Standby + projected + unreadable can be switched to; the quarantined one cannot.
    const switches = within(root).getAllByTestId('fleet-usage-switch');
    expect(switches).toHaveLength(3);
    // Forget is offered exactly where no usage could be read.
    expect(within(root).getAllByTestId('fleet-usage-remove')).toHaveLength(2);
    fireEvent.click(switches[0]!);
    expect(screen.getByText(/Switch the Claude login to fleet\.two@simulated\.test/)).toBeInTheDocument();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('hides the budgets block when the snapshot carries none', () => {
    render(<View model={simModel(false)} onSwitch={onSwitch} onRemove={onRemove} simulated />);
    expect(screen.queryByTestId('fleet-budgets')).toBeNull();
  });
});

describe('horizonX', () => {
  const HOUR = 3_600_000;
  it('is piecewise-linear: 5h is the seam, 7d the far edge, and it clamps', () => {
    expect(horizonX(0)).toBe(0);
    expect(horizonX(2.5 * HOUR)).toBeCloseTo(175);
    expect(horizonX(5 * HOUR)).toBeCloseTo(350);
    expect(horizonX(7 * 24 * HOUR)).toBeCloseTo(1000);
    expect(horizonX(30 * 24 * HOUR)).toBeCloseTo(1000);
    expect(horizonX(-5)).toBe(0);
  });
});
