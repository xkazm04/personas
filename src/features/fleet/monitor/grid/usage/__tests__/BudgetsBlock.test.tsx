// BudgetsBlock — the kill switch and the one-line hold.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { setAppSetting, useAppSettingMock } = vi.hoisted(() => ({
  setAppSetting: vi.fn(),
  useAppSettingMock: vi.fn(),
}));
vi.mock('@/api/system/settings', () => ({ setAppSetting, deleteAppSetting: vi.fn() }));
vi.mock('@/hooks/utility/data/useAppSetting', () => ({ useAppSetting: useAppSettingMock }));
vi.mock('@/lib/silentCatch', () => ({ toastCatch: () => () => {}, silentCatch: () => () => {} }));

import { BudgetsBlock, DYNAMIC_BUDGETS_KEY } from '../BudgetsBlock';
import { buildResourceModel } from '../useResourceModel';
import { buildSimBudgets } from '../../simulation/simPlans';
import type { FleetBudgets } from '@/lib/bindings/FleetBudgets';

function model(b: FleetBudgets | undefined) {
  return buildResourceModel({ accounts: null, single: null, cli: null, budgets: b, fetchedAt: null, now: 0 }).budgets;
}

function settingAt(value: string, loaded = true) {
  const setValue = vi.fn();
  useAppSettingMock.mockReturnValue({ value, setValue, save: vi.fn(), loaded, saved: false, error: null });
  return setValue;
}

describe('BudgetsBlock', () => {
  beforeEach(() => {
    setAppSetting.mockReset().mockResolvedValue(undefined);
    useAppSettingMock.mockReset();
  });

  it('renders nothing without budgets', () => {
    settingAt('true');
    const { container } = render(<BudgetsBlock budgets={model(undefined)} density="compact" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('binds the toggle to fleet.dynamic_budgets and writes the flipped value through the settings door', async () => {
    const setValue = settingAt('true');
    render(<BudgetsBlock budgets={model(buildSimBudgets())} density="compact" />);
    expect(useAppSettingMock).toHaveBeenCalledWith(DYNAMIC_BUDGETS_KEY, 'true', expect.any(Function));
    expect(DYNAMIC_BUDGETS_KEY).toBe('fleet.dynamic_budgets');
    const toggle = screen.getByTestId('fleet-budgets-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(setValue).toHaveBeenCalledWith('false');
    await waitFor(() => expect(setAppSetting).toHaveBeenCalledWith('fleet.dynamic_budgets', 'false'));
  });

  it('snaps the readout back when the write fails', async () => {
    const setValue = settingAt('false');
    setAppSetting.mockRejectedValue(new Error('nope'));
    render(<BudgetsBlock budgets={model(buildSimBudgets())} density="full" />);
    fireEvent.click(screen.getByTestId('fleet-budgets-toggle'));
    await waitFor(() => expect(setValue).toHaveBeenLastCalledWith('false'));
    expect(setValue).toHaveBeenNthCalledWith(1, 'true');
  });

  it('writes nothing while simulated — the switch flips locally', () => {
    settingAt('true');
    render(<BudgetsBlock budgets={model(buildSimBudgets())} density="compact" simulated />);
    fireEvent.click(screen.getByTestId('fleet-budgets-toggle'));
    expect(setAppSetting).not.toHaveBeenCalled();
    expect(screen.getByTestId('fleet-budgets')).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByTestId('fleet-budgets-hold')).toHaveAttribute('data-hold', 'off');
  });

  it.each([
    ['ahead_of_pace', 'ahead of plan pace'],
    ['five_hour_full', '5-hour window is full'],
    ['ram_high_water', 'high-water mark'],
    ['gpu_token_held', 'another session has the GPU'],
  ] as const)('says the %s hold in one line', (hold, copy) => {
    settingAt('true');
    render(<BudgetsBlock budgets={model({ ...buildSimBudgets(), hold })} density="compact" />);
    expect(screen.getByTestId('fleet-budgets-hold')).toHaveTextContent(copy);
  });

  it('shows the RAM gate state, the GPU holder and the pace factor in both densities', () => {
    settingAt('true');
    for (const density of ['compact', 'full'] as const) {
      const { unmount } = render(<BudgetsBlock budgets={model({ ...buildSimBudgets(), ramGate: 'closed' })} density={density} />);
      expect(screen.getByTestId('fleet-budgets-ram')).toHaveAttribute('data-gate', 'closed');
      expect(screen.getByTestId('fleet-budgets-ram')).toHaveTextContent('closed');
      expect(screen.getByTestId('fleet-budgets-gpu')).toHaveTextContent('held by sim-session-07');
      expect(screen.getByTestId('fleet-budgets-pace-factor')).toHaveTextContent('0.6');
      unmount();
    }
  });
});
