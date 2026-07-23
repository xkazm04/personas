/**
 * The debug recorder lives in Rust and outlives this button (and the whole
 * grid overlay), so the contract worth pinning is that the button *reflects
 * the backend* rather than its own memory: it adopts a recording already in
 * progress on mount, and it hands back the file path on stop — that path being
 * the entire artifact of a debugging run.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetDebugLogStatus } from '@/lib/bindings/FleetDebugLogStatus';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/fleet/fleet', () => ({
  debugLogStart: vi.fn(),
  debugLogStop: vi.fn(),
  debugLogStatus: vi.fn(),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import * as fleetApi from '@/api/fleet/fleet';
import { FleetDebugLogButton } from '../FleetDebugLogButton';

const status = (o: Partial<FleetDebugLogStatus> = {}): FleetDebugLogStatus => ({
  active: false,
  path: null,
  events: 0,
  startedAtMs: null,
  ...o,
});

describe('FleetDebugLogButton', () => {
  beforeEach(() => {
    vi.mocked(fleetApi.debugLogStatus).mockReset();
    vi.mocked(fleetApi.debugLogStart).mockReset();
    vi.mocked(fleetApi.debugLogStop).mockReset();
    addToast.mockReset();
  });

  it('offers to record when the backend is idle', async () => {
    vi.mocked(fleetApi.debugLogStatus).mockResolvedValue(status());
    render(<FleetDebugLogButton />);
    await waitFor(() =>
      expect(screen.getByTestId('fleet-debug-log-toggle')).toHaveAttribute('aria-pressed', 'false'),
    );
    expect(screen.getByTestId('fleet-debug-log-toggle')).toHaveTextContent('Record');
  });

  it('adopts a recording that was already running before it mounted', async () => {
    // The grid overlay unmounts every time the operator minimizes it; the
    // recorder does not stop. A button that trusted its own state would offer
    // to "Record" while a run was already in flight.
    vi.mocked(fleetApi.debugLogStatus).mockResolvedValue(
      status({ active: true, events: 42, path: 'C:/x/fleet-2026-07-23_14-05-31.log' }),
    );
    render(<FleetDebugLogButton />);
    const button = await screen.findByTestId('fleet-debug-log-toggle');
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    expect(button).toHaveTextContent('42');
    expect(fleetApi.debugLogStart).not.toHaveBeenCalled();
  });

  it('starts a recording when clicked while idle', async () => {
    vi.mocked(fleetApi.debugLogStatus).mockResolvedValue(status());
    vi.mocked(fleetApi.debugLogStart).mockResolvedValue(status({ active: true, path: 'C:/x/a.log' }));
    render(<FleetDebugLogButton />);
    await userEvent.click(await screen.findByTestId('fleet-debug-log-toggle'));
    await waitFor(() => expect(fleetApi.debugLogStart).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('fleet-debug-log-toggle')).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('surfaces the log path and event count on stop', async () => {
    vi.mocked(fleetApi.debugLogStatus).mockResolvedValue(status({ active: true, events: 7 }));
    vi.mocked(fleetApi.debugLogStop).mockResolvedValue(
      status({ active: false, events: 118, path: 'C:/data/fleet-debug/fleet-2026-07-23.log' }),
    );
    render(<FleetDebugLogButton />);
    const button = await screen.findByTestId('fleet-debug-log-toggle');
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));

    await userEvent.click(button);
    await waitFor(() => expect(fleetApi.debugLogStop).toHaveBeenCalled());

    const [message, , duration] = addToast.mock.calls[0] ?? [];
    expect(message).toContain('C:/data/fleet-debug/fleet-2026-07-23.log');
    expect(message).toContain('118');
    // The path is the deliverable — a default-length toast would lose it.
    expect(duration).toBeGreaterThanOrEqual(10_000);
  });
});
