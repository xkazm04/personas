import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { DevicePairingRequest } from '@/api/network/devices';
import { ApproveStep, APPROVE_ARM_MS } from '../wizard/ApproveStep';
import { AddPcDialog, type DeviceLink } from '../wizard/AddPcDialog';

const incoming: DevicePairingRequest = {
  peerId: 'peer-b',
  displayName: 'Laptop',
  fingerprint: '042-917',
  role: 'responder',
  requestedAt: '2026-11-05T10:00:00Z',
};

function fakeLink(over: Partial<DeviceLink> = {}): DeviceLink {
  return {
    ownedDevices: [],
    ownedDevicesLoading: false,
    ownedPeerIds: new Set<string>(),
    discoveredPeers: [],
    linkablePeers: [],
    p2pUnavailable: false,
    pending: [incoming],
    chosen: null,
    mismatch: null,
    outgoing: null,
    incoming: [incoming],
    outcome: null,
    pendingSynced: true,
    isBusy: () => false,
    startPairing: vi.fn(async () => {}),
    confirmCode: vi.fn(async () => {}),
    cancelPairing: vi.fn(async () => {}),
    dismissOutcome: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

describe('Approve step (receiving PC)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never renders the code it is checking', () => {
    render(<AddPcDialog open onClose={() => {}} link={fakeLink()} />);
    expect(screen.getByTestId('add-pc-wizard').dataset.step).toBe('approve');
    expect(document.body.textContent).not.toContain('042-917');
    expect(document.body.textContent).not.toContain('042');
    expect(document.body.textContent).not.toContain('917');
  });

  it('keeps Pair disarmed for the first 1.5 s, then arms it', () => {
    const onSubmit = vi.fn();
    render(<ApproveStep request={incoming} busy={false} attemptsLeft={null} onSubmit={onSubmit} onDecline={() => {}} />);
    fireEvent.change(screen.getByTestId('pairing-code-input'), { target: { value: '042 917' } });

    const pair = screen.getByTestId('incoming-confirm-peer-b');
    expect(pair).toBeDisabled();
    expect(pair.textContent).toContain('Read the request first');
    fireEvent.submit(screen.getByTestId('incoming-pairings'));
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(APPROVE_ARM_MS - 1));
    expect(screen.getByTestId('incoming-confirm-peer-b')).toBeDisabled();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('incoming-confirm-peer-b')).not.toBeDisabled();

    // Enter submits when armed, with the digits only.
    fireEvent.submit(screen.getByTestId('incoming-pairings'));
    expect(onSubmit).toHaveBeenCalledWith('042917');
  });

  it('accepts the grouped, spaced and bare forms', () => {
    const onSubmit = vi.fn();
    render(<ApproveStep request={incoming} busy={false} attemptsLeft={null} onSubmit={onSubmit} onDecline={() => {}} />);
    act(() => vi.advanceTimersByTime(APPROVE_ARM_MS));
    for (const typed of ['042-917', '042 917', '042917']) {
      fireEvent.change(screen.getByTestId('pairing-code-input'), { target: { value: typed } });
      fireEvent.submit(screen.getByTestId('incoming-pairings'));
    }
    expect(onSubmit.mock.calls).toEqual([['042917'], ['042917'], ['042917']]);
  });

  it('does not submit an incomplete code', () => {
    const onSubmit = vi.fn();
    render(<ApproveStep request={incoming} busy={false} attemptsLeft={null} onSubmit={onSubmit} onDecline={() => {}} />);
    act(() => vi.advanceTimersByTime(APPROVE_ARM_MS));
    fireEvent.change(screen.getByTestId('pairing-code-input'), { target: { value: '04291' } });
    fireEvent.submit(screen.getByTestId('incoming-pairings'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the tries left after a wrong code', () => {
    render(<ApproveStep request={incoming} busy={false} attemptsLeft={3} onSubmit={() => {}} onDecline={() => {}} />);
    expect(screen.getByText(/not the code - 3 tries left/)).toBeInTheDocument();
  });

  it('says "1 try left" on the last try', () => {
    render(<ApproveStep request={incoming} busy={false} attemptsLeft={1} onSubmit={() => {}} onDecline={() => {}} />);
    expect(screen.getByText(/1 try left/)).toBeInTheDocument();
  });
});

describe('AddPcDialog', () => {
  it('shows the initiator code on the Code step', () => {
    const request = { ...incoming, peerId: 'peer-a', displayName: 'Studio', role: 'initiator' as const };
    render(
      <AddPcDialog
        open
        onClose={() => {}}
        link={fakeLink({
          pending: [request],
          incoming: [],
          chosen: { peerId: 'peer-a', displayName: 'Studio', request, phase: 'waiting' },
        })}
      />,
    );
    expect(screen.getByTestId('add-pc-wizard').dataset.step).toBe('code');
    expect(screen.getByTestId('pairing-fingerprint').textContent).toBe('042917');
  });

  it('Done returns to the page and acknowledges the result', () => {
    const onClose = vi.fn();
    const link = fakeLink({
      pending: [],
      incoming: [],
      outcome: { kind: 'paired', peerId: 'peer-b', displayName: 'Laptop' },
    });
    render(<AddPcDialog open={false} onClose={onClose} link={link} />);
    expect(screen.getByText('Laptop is one of your PCs now')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-done-back'));
    expect(link.dismissOutcome).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
