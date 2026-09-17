// MaxParallelStepper — the header's cap control.
//
// Three contracts: it renders `running / cap` from the setting and the door's
// count; the − / + write the clamped neighbour through the generic settings
// door and refuse at the bounds; over-admission paints the warning tone.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { setAppSetting, useAppSettingMock } = vi.hoisted(() => ({
  setAppSetting: vi.fn(),
  useAppSettingMock: vi.fn(),
}));
vi.mock('@/api/system/settings', () => ({ setAppSetting, deleteAppSetting: vi.fn() }));
vi.mock('@/hooks/utility/data/useAppSetting', () => ({ useAppSetting: useAppSettingMock }));
vi.mock('@/lib/silentCatch', () => ({ toastCatch: () => () => {}, silentCatch: () => () => {} }));

import { MaxParallelStepper } from '../MaxParallelStepper';
import { FLEET_MAX_PARALLEL_SESSIONS_BOUNDS as B } from '@/features/settings/sub_limits/autopilotBounds';

function settingAt(value: string) {
  const setValue = vi.fn();
  useAppSettingMock.mockReturnValue({ value, setValue, save: vi.fn(), loaded: true, saved: false, error: null });
  return setValue;
}

describe('MaxParallelStepper', () => {
  beforeEach(() => {
    setAppSetting.mockReset().mockResolvedValue(undefined);
    useAppSettingMock.mockReset();
  });

  it('reads the fleet.max_parallel_sessions bound and renders running / cap', () => {
    settingAt('10');
    render(<MaxParallelStepper running={4} overAdmitted={0} />);
    expect(useAppSettingMock).toHaveBeenCalledWith(B.key, String(B.defaultValue), expect.any(Function));
    const readout = screen.getByTestId('fleet-max-parallel-readout');
    expect(readout.textContent?.replace(/\s/g, '')).toBe('4/10');
    expect(screen.getByTestId('fleet-max-parallel')).not.toHaveAttribute('data-over');
  });

  it('writes the neighbour on − / + and clamps at the bounds', async () => {
    const setValue = settingAt('10');
    render(<MaxParallelStepper running={10} overAdmitted={0} />);
    const [minus, plus] = screen.getAllByRole('button');
    fireEvent.click(plus!);
    await waitFor(() => expect(setAppSetting).toHaveBeenCalledWith(B.key, '11'));
    expect(setValue).toHaveBeenCalledWith('11');
    fireEvent.click(minus!);
    await waitFor(() => expect(setAppSetting).toHaveBeenCalledWith(B.key, '9'));

    setAppSetting.mockClear();
    settingAt(String(B.max));
    render(<MaxParallelStepper running={0} overAdmitted={0} />);
    const plusAtMax = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label') && (b as HTMLButtonElement).disabled);
    expect(plusAtMax.length).toBeGreaterThan(0);
  });

  it('refuses a stored value outside the bounds by clamping the readout', () => {
    settingAt('99');
    render(<MaxParallelStepper running={0} overAdmitted={0} />);
    expect(screen.getByTestId('fleet-max-parallel-readout').textContent?.replace(/\s/g, '')).toBe(`0/${B.max}`);
  });

  it('paints over-admission as 11 / 10 in the warning tone', () => {
    settingAt('10');
    render(<MaxParallelStepper running={11} overAdmitted={1} />);
    expect(screen.getByTestId('fleet-max-parallel')).toHaveAttribute('data-over', 'true');
    expect(screen.getByTestId('fleet-max-parallel-readout').textContent?.replace(/\s/g, '')).toBe('11/10');
    expect(screen.getByTestId('fleet-max-parallel-readout').className).toContain('text-status-warning');
  });

  it('is inert on a simulated board', () => {
    settingAt('10');
    render(<MaxParallelStepper running={1} overAdmitted={0} disabled />);
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});
