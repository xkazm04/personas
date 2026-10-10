/**
 * Pairing has no default web address (H2): the QR's page receives the pairing
 * secret, and the old fallback pointed at a domain nobody controls. So:
 *  - with no Pairing address set, the panel says pairing is off and
 *    "Pair a phone" stays disabled (the backend refuses too);
 *  - saving an address enables it; clearing it disables it again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CloudPairingOrigin } from '@/lib/bindings/CloudPairingOrigin';

const getCloudPairingOrigin = vi.fn<() => Promise<CloudPairingOrigin>>();
const setCloudPairingOrigin = vi.fn<(origin: string | null) => Promise<CloudPairingOrigin>>();
const startControllerPairing = vi.fn();
vi.mock('@/api/cloudSync', () => ({
  getCloudPairingOrigin: () => getCloudPairingOrigin(),
  setCloudPairingOrigin: (origin: string | null) => setCloudPairingOrigin(origin),
  listCloudControllers: vi.fn().mockResolvedValue([]),
  startControllerPairing: () => startControllerPairing(),
  pollControllerPairing: vi.fn(),
  cancelControllerPairing: vi.fn().mockResolvedValue(undefined),
  revokeCloudController: vi.fn(),
}));

import PairedPhonesPanel from '../PairedPhonesPanel';

const UNSET: CloudPairingOrigin = { origin: '', custom: false };
const DESK: CloudPairingOrigin = { origin: 'https://desk.example', custom: true };

function pairButton() {
  return screen.getByRole('button', { name: /pair a phone/i });
}

beforeEach(() => {
  getCloudPairingOrigin.mockReset();
  setCloudPairingOrigin.mockReset();
  startControllerPairing.mockReset();
});

describe('PairedPhonesPanel: no pairing without a Pairing address', () => {
  it('says pairing is off and keeps Pair a phone disabled while no address is set', async () => {
    getCloudPairingOrigin.mockResolvedValue(UNSET);
    render(<PairedPhonesPanel />);
    const unset = await screen.findByTestId('cloud-pairing-origin-unset');
    expect(unset.textContent).toMatch(/pairing is off/i);
    expect(screen.queryByTestId('cloud-pairing-origin-effective')).toBeNull();
    expect(pairButton()).toBeDisabled();
    fireEvent.click(pairButton());
    expect(startControllerPairing).not.toHaveBeenCalled();
  });

  it('stays disabled when the address could not be loaded', async () => {
    getCloudPairingOrigin.mockRejectedValue(new Error('boom'));
    render(<PairedPhonesPanel />);
    await waitFor(() => expect(getCloudPairingOrigin).toHaveBeenCalled());
    expect(pairButton()).toBeDisabled();
  });

  it('enables Pair a phone once an address is set, and shows where the QR opens', async () => {
    getCloudPairingOrigin.mockResolvedValue(DESK);
    render(<PairedPhonesPanel />);
    const opens = await screen.findByTestId('cloud-pairing-origin-effective');
    expect(opens.textContent).toContain('https://desk.example');
    expect(screen.queryByTestId('cloud-pairing-origin-unset')).toBeNull();
    await waitFor(() => expect(pairButton()).not.toBeDisabled());
  });

  it('follows a save: setting enables the button, clearing disables it again', async () => {
    getCloudPairingOrigin.mockResolvedValue(UNSET);
    render(<PairedPhonesPanel />);
    await screen.findByTestId('cloud-pairing-origin-unset');
    expect(pairButton()).toBeDisabled();

    const input = screen.getByTestId('cloud-pairing-origin');
    setCloudPairingOrigin.mockResolvedValueOnce(DESK);
    fireEvent.change(input, { target: { value: 'https://desk.example' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(pairButton()).not.toBeDisabled());
    expect(setCloudPairingOrigin).toHaveBeenCalledWith('https://desk.example');

    setCloudPairingOrigin.mockResolvedValueOnce(UNSET);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(pairButton()).toBeDisabled());
    expect(setCloudPairingOrigin).toHaveBeenLastCalledWith(null);
    expect(await screen.findByTestId('cloud-pairing-origin-unset')).toBeTruthy();
  });
});
