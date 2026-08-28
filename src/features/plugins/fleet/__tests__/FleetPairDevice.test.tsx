/**
 * Unit tests for FleetPairDevice — the two paths where a failure must reach a
 * human, and the timer that must not outlive the component.
 *
 * Revocation is a security action: an operator clicks Revoke to cut a paired
 * phone's access and walks away. The failure mode this file pins is the one
 * that is invisible by construction — the call rejects, nothing changes on
 * screen, and the operator believes a device is disconnected while it is still
 * paired. `useTranslation` is the real proxy, so the copy asserted here is the
 * shipped English bundle, not a fixture.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetCompanionStatus } from '@/api/fleet/fleet';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const STATUS: FleetCompanionStatus = {
  devices: [{ id: 'dev-1', name: 'Pixel 9', lastSeenMs: 0, revoked: false }],
} as unknown as FleetCompanionStatus;

vi.mock('@/api/fleet/fleet', () => ({
  pairDevice: vi.fn(),
  companionDevices: vi.fn(),
  revokeCompanionDevice: vi.fn(),
}));

vi.mock('@/hooks/utility/interaction/useCopyToClipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

import * as fleetApi from '@/api/fleet/fleet';
import { FleetPairDevice } from '../FleetPairDevice';

beforeEach(() => {
  addToast.mockClear();
  vi.mocked(fleetApi.companionDevices).mockReset().mockResolvedValue(STATUS);
  vi.mocked(fleetApi.revokeCompanionDevice).mockReset();
  vi.mocked(fleetApi.pairDevice).mockReset();
});

describe('FleetPairDevice — revocation failure is never silent', () => {
  it('toasts when revoking a device fails, instead of leaving the row unchanged', async () => {
    vi.mocked(fleetApi.revokeCompanionDevice).mockRejectedValue(new Error('device offline'));
    const user = userEvent.setup();

    render(<FleetPairDevice />);
    const revokeBtn = await screen.findByTestId('fleet-pair-revoke-dev-1');
    await user.click(revokeBtn);

    // The whole point: the operator is TOLD. A silent catch here would leave
    // them believing a still-paired phone had been cut off.
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(String(addToast.mock.calls[0]![0])).toMatch(/could not revoke/i);
    expect(addToast.mock.calls[0]![1]).toBe('error');
  });

  it('stays quiet and refreshes the device list when revocation succeeds', async () => {
    vi.mocked(fleetApi.revokeCompanionDevice).mockResolvedValue(undefined as never);
    const user = userEvent.setup();

    render(<FleetPairDevice />);
    await user.click(await screen.findByTestId('fleet-pair-revoke-dev-1'));

    await waitFor(() => expect(fleetApi.companionDevices).toHaveBeenCalledTimes(2));
    expect(addToast).not.toHaveBeenCalled();
  });
});

describe('FleetPairDevice — pairing failure is announced', () => {
  it('renders the pairing error in a live region so a screen reader hears it', async () => {
    vi.mocked(fleetApi.pairDevice).mockRejectedValue(new Error('server refused'));
    const user = userEvent.setup();

    render(<FleetPairDevice />);
    await user.click(screen.getByTestId('fleet-pair-generate'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toMatch(/pairing failed/i);
  });
});
