/**
 * Unit tests for FleetProcessScanner's kill-confirmation re-validation.
 *
 * PIDs are recycled by the OS, so the `FleetDetectedProcess` snapshot
 * captured when the user opens the "Kill?" confirm dialog can no longer
 * describe the same process by the time they click confirm. `doKill` must
 * re-scan and resolve the target against the LIVE list before writing —
 * never act on a dangling/stale snapshot (see the "resolve against the live
 * collection" doctrine also applied in FleetGridPage / FleetBroadcastModal).
 *
 * The fleet API and both Zustand stores it touches (`systemStore` for the
 * orphan-count badge, `toastStore` for the abort/failure toast that
 * `toastCatch` fires) are mocked at the module boundary so this stays in
 * jsdom. `useTranslation` is the real proxy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  // `toastCatch` (used by the abort path) reaches the store via the static
  // `.getState()` escape hatch, not the selector-hook form.
  useToastStore: { getState: () => ({ addToast }) },
}));

const setOrphanCount = vi.fn();
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: { fleetSetOrphanCount: typeof setOrphanCount }) => unknown) =>
    selector({ fleetSetOrphanCount: setOrphanCount }),
}));

vi.mock('@/api/fleet/fleet', () => ({
  detectProcesses: vi.fn(),
  killPid: vi.fn(),
  resumeOrphan: vi.fn(),
}));

import * as fleetApi from '@/api/fleet/fleet';
import { FleetProcessScanner } from '../FleetProcessScanner';

function proc(overrides: Partial<FleetDetectedProcess> = {}): FleetDetectedProcess {
  return {
    pid: 100,
    name: 'claude',
    cmd: 'claude',
    cwd: '/repo/a',
    memoryBytes: BigInt(10 * 1024 * 1024),
    tracked: false,
    interactive: true,
    ...overrides,
  };
}

async function openConfirmDialog(user: ReturnType<typeof userEvent.setup>, pid: number) {
  await user.click(await screen.findByTestId(`fleet-kill-process-${pid}`));
  return within(await screen.findByRole('dialog'));
}

describe('FleetProcessScanner — kill re-validation', () => {
  beforeEach(() => {
    vi.mocked(fleetApi.detectProcesses).mockReset();
    vi.mocked(fleetApi.killPid).mockReset().mockResolvedValue(undefined);
    vi.mocked(fleetApi.resumeOrphan).mockReset();
    addToast.mockClear();
    setOrphanCount.mockClear();
  });

  it('kills the target pid when a fresh scan still finds the same process', async () => {
    const user = userEvent.setup();
    const p = proc();
    vi.mocked(fleetApi.detectProcesses)
      .mockResolvedValueOnce([p]) // initial mount scan
      .mockResolvedValueOnce([p]); // re-validation scan inside doKill — still there

    render(<FleetProcessScanner />);

    const dialog = await openConfirmDialog(user, 100);
    await user.click(dialog.getByRole('button', { name: 'Kill' }));

    await waitFor(() => expect(fleetApi.killPid).toHaveBeenCalledWith(100));
  });

  it('aborts without killing when the pid was recycled by another process before confirm', async () => {
    const user = userEvent.setup();
    const p = proc();
    // A different process now owns pid 100 (or it's simply gone) by the time
    // the confirm click fires the re-validation scan.
    const impostor: FleetDetectedProcess = { ...p, cmd: 'some-other-process', cwd: null };
    vi.mocked(fleetApi.detectProcesses)
      .mockResolvedValueOnce([p]) // initial mount scan
      .mockResolvedValueOnce([impostor]); // re-validation scan — same pid, different process

    render(<FleetProcessScanner />);

    const dialog = await openConfirmDialog(user, 100);
    await user.click(dialog.getByRole('button', { name: 'Kill' }));

    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(fleetApi.killPid).not.toHaveBeenCalled();
  });

  it('aborts without killing when the process has simply vanished by confirm time', async () => {
    const user = userEvent.setup();
    const p = proc();
    vi.mocked(fleetApi.detectProcesses)
      .mockResolvedValueOnce([p]) // initial mount scan
      .mockResolvedValueOnce([]); // re-validation scan — process is gone

    render(<FleetProcessScanner />);

    const dialog = await openConfirmDialog(user, 100);
    await user.click(dialog.getByRole('button', { name: 'Kill' }));

    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(fleetApi.killPid).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('No Claude sessions running.')).toBeInTheDocument(),
    );
  });
});
