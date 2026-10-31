import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const listPendingPairings = vi.fn();
const approvePairing = vi.fn();
vi.mock('@/api/auth/pairing', () => ({
  listPendingPairings: () => listPendingPairings(),
  approvePairing: (...a: unknown[]) => approvePairing(...a),
  rejectPairing: vi.fn(),
}));
vi.mock('@/hooks/useTauriEvent', () => ({ useTauriEvent: () => {} }));

import PairApprovalModal from './PairApprovalModal';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const pairing = {
  nonce: 'n1',
  app_name: 'Cloud App',
  origin: 'https://app.example.com',
  requested_scopes: ['personas:build', 'personas:read'],
};

beforeEach(() => {
  listPendingPairings.mockReset().mockResolvedValue([pairing]);
  approvePairing.mockReset().mockResolvedValue(undefined);
});

describe('PairApprovalModal scope selection', () => {
  it('states what an empty selection still grants (read-only)', async () => {
    render(<PairApprovalModal />);
    const build = await screen.findByRole('button', { name: /personas:build/ });
    // The settings strings load lazily; wait for them before asserting on text.
    await screen.findByText('Approve');
    expect(screen.queryByText(/Read-only \(list agents/)).toBeNull();
    fireEvent.click(build);
    expect(screen.queryByText(/Read-only \(list agents/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /personas:read/ }));
    expect(screen.queryByText(/Read-only \(list agents/)).not.toBeNull();
    fireEvent.click(build);
    expect(screen.queryByText(/Read-only \(list agents/)).toBeNull();
  });
});

/**
 * The ceremony gate: Approve is inert for APPROVE_ARM_DELAY_MS (450 ms) and
 * approvePairing receives exactly the ticked subset plus the chosen expiry.
 * Fake timers freeze the clock; real sleeps only let the lazy locale chunk and
 * the pending-pairings promise settle without advancing fake time.
 */
describe('PairApprovalModal approval ceremony', () => {
  const realSetTimeout = globalThis.setTimeout;
  const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

  async function renderFrozen() {
    vi.useFakeTimers();
    render(<PairApprovalModal />);
    for (let i = 0; i < 100 && !screen.queryByText('Approve'); i++) {
      await act(async () => {
        await realSleep(20);
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    return screen.getByTestId('pair-approve') as HTMLButtonElement;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps Approve inert until 450 ms have passed, then arms it', async () => {
    const approve = await renderFrozen();
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(approvePairing).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(449);
    });
    expect(approve.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(approve.disabled).toBe(false);
  });

  it('approves with exactly the ticked subset and the chosen expiry', async () => {
    const approve = await renderFrozen();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    fireEvent.click(screen.getByRole('button', { name: /personas:build/ }));
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await act(async () => {
      fireEvent.click(approve);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(approvePairing).toHaveBeenCalledTimes(1);
    expect(approvePairing).toHaveBeenCalledWith('n1', ['personas:read'], 7);
  });

  it('defaults to every requested scope and 30 days', async () => {
    const approve = await renderFrozen();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await act(async () => {
      fireEvent.click(approve);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(approvePairing).toHaveBeenCalledWith('n1', ['personas:build', 'personas:read'], 30);
  });
});
