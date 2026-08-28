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
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
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

/**
 * Generate was guarded only by `busy`, so pressing it again while a live token
 * was on screen minted another one — no confirmation, no cap, no notice that
 * the previous token stays valid until revoked. Two live device-scoped
 * credentials for a LAN-exposed surface, and nothing on either row saying which
 * one the phone holds.
 */
describe('FleetPairDevice — a second token is not minted silently', () => {
  const PAIR = { url: 'http://192.168.1.5:8765/#tok', qrSvg: '<svg/>' } as never;

  it('mints on the first press with no confirmation to get in the way', async () => {
    vi.mocked(fleetApi.pairDevice).mockResolvedValue(PAIR);
    const user = userEvent.setup();

    render(<FleetPairDevice />);
    await user.click(screen.getByTestId('fleet-pair-generate'));

    await screen.findByTestId('fleet-pair-qr');
    expect(fleetApi.pairDevice).toHaveBeenCalledTimes(1);
  });

  it('confirms before a SECOND mint, and names what happens to the first token', async () => {
    vi.mocked(fleetApi.pairDevice).mockResolvedValue(PAIR);
    const user = userEvent.setup();

    render(<FleetPairDevice />);
    await user.click(screen.getByTestId('fleet-pair-generate'));
    await screen.findByTestId('fleet-pair-qr');

    await user.click(screen.getByTestId('fleet-pair-generate'));

    // Still ONE token minted — the press opened a dialog, it did not mint.
    expect(fleetApi.pairDevice).toHaveBeenCalledTimes(1);
    // The stake is spelled out, not left to the operator to infer.
    expect(screen.getByText(/stays valid until you revoke it/i)).toBeInTheDocument();
  });

  it('mints nothing when the confirmation is cancelled', async () => {
    vi.mocked(fleetApi.pairDevice).mockResolvedValue(PAIR);
    const user = userEvent.setup();

    render(<FleetPairDevice />);
    await user.click(screen.getByTestId('fleet-pair-generate'));
    await screen.findByTestId('fleet-pair-qr');
    await user.click(screen.getByTestId('fleet-pair-generate'));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(fleetApi.pairDevice).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/stays valid until you revoke it/i)).toBeNull();
  });

  it('still mints when the operator confirms', async () => {
    vi.mocked(fleetApi.pairDevice).mockResolvedValue(PAIR);
    const user = userEvent.setup();

    render(<FleetPairDevice />);
    await user.click(screen.getByTestId('fleet-pair-generate'));
    await screen.findByTestId('fleet-pair-qr');
    await user.click(screen.getByTestId('fleet-pair-generate'));
    await user.click(screen.getByRole('button', { name: /generate anyway/i }));

    await waitFor(() => expect(fleetApi.pairDevice).toHaveBeenCalledTimes(2));
  });
});

describe('FleetPairDevice — copy confirmation timer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the copied-reset timer on unmount instead of leaving it pending', async () => {
    vi.mocked(fleetApi.pairDevice).mockResolvedValue({
      url: 'http://192.168.1.5:8765/#tok',
      qrSvg: '<svg/>',
    } as never);
    const user = userEvent.setup();

    // Watch the real timer functions rather than swapping in fake ones:
    // userEvent needs real timers, and a timer armed under real timers is
    // invisible to vi.getTimerCount() anyway.
    const armed: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const setSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
        const id = (realSetTimeout as (...a: unknown[]) => unknown)(fn, ms, ...rest);
        if (ms === 1500) armed.push(id);
        return id;
      }) as unknown as typeof globalThis.setTimeout);
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { unmount } = render(<FleetPairDevice />);
    await user.click(screen.getByTestId('fleet-pair-generate'));
    await user.click(await screen.findByTestId('fleet-pair-copy'));
    await screen.findByLabelText(/copied/i);

    // The 1.5s confirmation window is in flight at this point.
    expect(armed).toHaveLength(1);

    unmount();

    // Without a cleanup effect the callback survives the component and fires
    // setCopied on a torn-down tree, holding a closure over a view that
    // displayed a one-time-use pairing token.
    expect(clearSpy.mock.calls.some((c) => c[0] === armed[0])).toBe(true);
    setSpy.mockRestore();
  });
});
