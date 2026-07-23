/**
 * The footer pill exists to keep the recorder stoppable after you leave the
 * grid header where it was started. Two things matter: it stays invisible
 * until a recording is actually running (so it never clutters the footer), and
 * when it IS running it stops the recorder — the reachable-stop guarantee.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetDebugLogStatus } from '@/lib/bindings/FleetDebugLogStatus';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const store = {
  fleetApplyDebugLogStatus: vi.fn((s: { active: boolean; events: number; path: string | null }) => {
    store.fleetDebugLogActive = s.active;
    store.fleetDebugLogEvents = s.events;
    store.fleetDebugLogPath = s.path;
  }),
  fleetDebugLogActive: false,
  fleetDebugLogEvents: 0,
  fleetDebugLogPath: null as string | null,
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) => selector({ addToast }),
}));

vi.mock('@/api/fleet/fleet', () => ({
  debugLogStart: vi.fn(),
  debugLogStop: vi.fn(),
  debugLogStatus: vi.fn(),
}));

import * as fleetApi from '@/api/fleet/fleet';
import { FleetDebugLogFooterPill } from '../FleetDebugLogFooterPill';

const status = (o: Partial<FleetDebugLogStatus> = {}): FleetDebugLogStatus => ({
  active: false,
  path: null,
  events: 0,
  startedAtMs: null,
  ...o,
});

describe('FleetDebugLogFooterPill', () => {
  beforeEach(() => {
    store.fleetDebugLogActive = false;
    store.fleetDebugLogEvents = 0;
    store.fleetDebugLogPath = null;
    addToast.mockReset();
    vi.mocked(fleetApi.debugLogStatus).mockReset().mockResolvedValue(status());
    vi.mocked(fleetApi.debugLogStop).mockReset().mockResolvedValue(status({ active: false, events: 9, path: 'C:/x/a.log' }));
  });

  it('renders nothing while no recording is active', () => {
    render(<FleetDebugLogFooterPill />);
    expect(screen.queryByTestId('footer-debug-log-stop')).not.toBeInTheDocument();
  });

  it('shows a stop control while a recording is active, even outside the grid', () => {
    store.fleetDebugLogActive = true;
    store.fleetDebugLogEvents = 55;
    render(<FleetDebugLogFooterPill />);
    const pill = screen.getByTestId('footer-debug-log-stop');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('55');
  });

  it('stops the recorder when clicked', async () => {
    store.fleetDebugLogActive = true;
    render(<FleetDebugLogFooterPill />);
    await userEvent.click(screen.getByTestId('footer-debug-log-stop'));
    await waitFor(() => expect(fleetApi.debugLogStop).toHaveBeenCalled());
    expect(store.fleetDebugLogActive).toBe(false);
    expect(addToast.mock.calls.at(-1)?.[0]).toContain('C:/x/a.log');
  });
});
