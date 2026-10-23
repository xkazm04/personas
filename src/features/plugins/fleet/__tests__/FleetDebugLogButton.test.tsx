/**
 * The debug recorder lives in Rust and outlives this button (and the whole
 * grid overlay), so state is held in the fleet store and driven through
 * `useFleetDebugLog`. The contract here is that the grid-header button reflects
 * that shared state and toggles it: start when idle, stop when armed.
 *
 * The store and the fleet API are mocked at the module boundary; `useToastStore`
 * is stubbed because the shared hook toasts on start/stop.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetDebugLogStatus } from '@/lib/bindings/FleetDebugLogStatus';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const applied: Array<{ active: boolean; events: number; path: string | null }> = [];
const store = {
  fleetApplyDebugLogStatus: (s: { active: boolean; events: number; path: string | null }) => {
    applied.push(s);
    store.fleetDebugLogActive = s.active;
    store.fleetDebugLogEvents = s.events;
    store.fleetDebugLogPath = s.path;
  },
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
import { FleetDebugLogButton } from '../FleetDebugLogButton';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

// `plugins` is a code-split i18n section: it reaches the runtime through an
// async chunk, so a render before it lands reads every label as undefined and
// a copy assertion races the import. Await it once, before any render.
beforeAll(() => preloadSectionsAsync('en', ['plugins']));

const status = (o: Partial<FleetDebugLogStatus> = {}): FleetDebugLogStatus => ({
  active: false,
  path: null,
  events: 0,
  startedAtMs: null,
  ...o,
});

describe('FleetDebugLogButton', () => {
  beforeEach(() => {
    applied.length = 0;
    store.fleetDebugLogActive = false;
    store.fleetDebugLogEvents = 0;
    store.fleetDebugLogPath = null;
    addToast.mockReset();
    vi.mocked(fleetApi.debugLogStatus).mockReset().mockResolvedValue(status());
    vi.mocked(fleetApi.debugLogStart).mockReset().mockResolvedValue(status({ active: true, path: 'C:/x/a.log' }));
    vi.mocked(fleetApi.debugLogStop).mockReset().mockResolvedValue(status({ active: false, events: 12, path: 'C:/x/a.log' }));
  });

  it('offers to record when the store shows idle', async () => {
    render(<FleetDebugLogButton />);
    const button = screen.getByTestId('fleet-debug-log-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('Record');
  });

  it('starts a recording when clicked while idle', async () => {
    render(<FleetDebugLogButton />);
    await userEvent.click(screen.getByTestId('fleet-debug-log-toggle'));
    await waitFor(() => expect(fleetApi.debugLogStart).toHaveBeenCalled());
    expect(applied.at(-1)).toMatchObject({ active: true });
  });

  it('reflects a recording that another surface already started', () => {
    store.fleetDebugLogActive = true;
    store.fleetDebugLogEvents = 42;
    render(<FleetDebugLogButton />);
    const button = screen.getByTestId('fleet-debug-log-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('42');
  });

  it('stops the recording when clicked while armed, and toasts the path', async () => {
    // The mount-time status refresh adopts whatever the backend reports, so an
    // "armed" fixture must say armed on BOTH sides: a backend that answers idle
    // disarms the store under the click, and the test then exercises start.
    store.fleetDebugLogActive = true;
    vi.mocked(fleetApi.debugLogStatus).mockResolvedValue(status({ active: true, events: 3, path: 'C:/x/a.log' }));
    render(<FleetDebugLogButton />);
    await userEvent.click(screen.getByTestId('fleet-debug-log-toggle'));
    await waitFor(() => expect(fleetApi.debugLogStop).toHaveBeenCalled());
    expect(fleetApi.debugLogStart).not.toHaveBeenCalled();
    const [message, , duration] = addToast.mock.calls.at(-1) ?? [];
    expect(message).toContain('C:/x/a.log');
    expect(duration).toBeGreaterThanOrEqual(10_000);
  });
});
