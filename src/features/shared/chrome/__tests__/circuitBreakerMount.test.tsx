/**
 * THE CIRCUIT BREAKER REACHES A PIXEL.
 *
 * `CircuitBreakerIndicator` is the sole UI consumer of
 * `get_circuit_breaker_status` and had ZERO importers repo-wide: a provider
 * trip rendered nowhere, and the user saw an unexplained wall of failed runs.
 * Its own comment even claimed it was "mounted at the dashboard top-bar",
 * which was false.
 *
 * What is pinned here is the property that was missing, not the markup: the
 * persistent title-bar tray mounts it, a tripped status renders it, and a
 * healthy one renders nothing at all (so the mount costs no pixels when the
 * fleet is fine).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CircuitBreakerStatus } from '@/lib/bindings/CircuitBreakerStatus';

const t = new Proxy(
  {},
  {
    get: (_o, section) =>
      new Proxy({}, { get: (_s, key) => `${String(section)}.${String(key)}` }),
  },
);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => {}),
}));

const mockGetStatus = vi.fn();
vi.mock('@/api/agents/executions', () => ({
  getCircuitBreakerStatus: () => mockGetStatus(),
}));

// The tray's other two overlays are lazy full-surface trees; the tray is only
// asked here whether it mounts the indicator, so keep them out of the graph.
vi.mock('@/features/fleet/monitor', () => ({ PersonaMonitor: () => null }));
vi.mock('@/features/agents/quick-answer/QuickAnswerPopover', () => ({
  QuickAnswerPopover: () => null,
}));
vi.mock('@/features/schedules/components/ScheduleTimeline', () => ({ default: () => null }));

const systemState = { headerOverlay: 'none' as string, setHeaderOverlay: vi.fn() };
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof systemState) => unknown) => selector(systemState),
}));

// The tray module also pulls four app stores at module scope for the DOCK's
// counts, none of which `TrayOverlays` reads. Stubbing them keeps this file's
// import graph to the thing under test (without them the worker spends longer
// transforming the store tree than the pool will wait for it).
vi.mock('@/stores/notificationCenterStore', () => ({ useNotificationCenterStore: () => 0 }));
vi.mock('@/stores/overviewStore', () => ({ useOverviewStore: () => 0 }));
vi.mock('@/stores/agentStore', () => ({ useAgentStore: () => 0 }));
vi.mock('@/stores/commandPaletteStore', () => ({ useCommandPaletteStore: () => () => {} }));

import { TrayOverlays } from '../useTitleBarTray';

function status(over: Partial<CircuitBreakerStatus> = {}): CircuitBreakerStatus {
  return {
    globalPaused: false,
    globalFailureCount: 0,
    globalCooldownRemainingSecs: 0,
    providers: [],
    recentTransitions: [],
    ...over,
  } as CircuitBreakerStatus;
}

describe('circuit breaker mount (title-bar tray)', () => {
  beforeEach(() => {
    mockGetStatus.mockReset();
    systemState.headerOverlay = 'none';
  });

  it('renders the indicator from persistent chrome when the breaker is tripped', async () => {
    mockGetStatus.mockResolvedValue(
      status({
        globalPaused: true,
        globalFailureCount: 5,
        globalCooldownRemainingSecs: 30,
      }),
    );
    render(<TrayOverlays />);
    // The whole point: no route, no tab, no dashboard — the tray alone.
    expect(await screen.findByTestId('circuit-breaker-indicator')).toBeInTheDocument();
  });

  it('renders nothing at all while every provider is healthy', async () => {
    mockGetStatus.mockResolvedValue(
      status({
        providers: [
          {
            provider: 'anthropic',
            isOpen: false,
            consecutiveFailures: 0,
            cooldownRemainingSecs: 0,
            tripCount1h: 0,
          },
        ] as CircuitBreakerStatus['providers'],
      }),
    );
    const { container } = render(<TrayOverlays />);
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('circuit-breaker-indicator')).toBeNull();
    // And no placeholder standing in for it: the old skeleton pulsed on every
    // launch, announcing a problem that did not exist.
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('shows the open provider when one trips', async () => {
    mockGetStatus.mockResolvedValue(
      status({
        providers: [
          {
            provider: 'anthropic',
            isOpen: true,
            consecutiveFailures: 3,
            cooldownRemainingSecs: 12,
            tripCount1h: 2,
          },
        ] as CircuitBreakerStatus['providers'],
      }),
    );
    render(<TrayOverlays />);
    expect(await screen.findByTestId('circuit-breaker-indicator')).toBeInTheDocument();
  });
});
