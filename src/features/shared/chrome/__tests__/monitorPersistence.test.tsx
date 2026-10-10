/**
 * THE MONITOR IS BUILT ONCE PER APP SESSION.
 *
 * `TrayOverlays` used to render the Monitor as `{headerOverlay === 'monitor'
 * && <Suspense key="monitor">...}` inside `AnimatePresence`, so every close
 * tore down a 212-module tree, disposed about twelve poll registrations and
 * re-ran every mount effect; the next open paid for all of it again.
 *
 * What is pinned here is the whole of that contract and nothing about the
 * Monitor's insides:
 *  • nothing is requested until the operator opens it the first time (the
 *    chunk must stay lazy — persistence is about the SECOND open);
 *  • open / close / reopen mounts it exactly once;
 *  • closed means `visible={false}`, not unmounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// --- mocks (declared before the import under test) -------------------------

const h = vi.hoisted(() => ({
  /** Mounts of the Monitor across the whole test — the number under test. */
  mounts: 0,
  /** Was the Monitor's module ever imported? Proves the chunk stayed lazy. */
  moduleLoaded: false,
  /** The `visible` prop as last rendered. */
  lastVisible: null as boolean | null,
}));

const setHeaderOverlay = vi.fn();
const systemState = { headerOverlay: 'none' as string, setHeaderOverlay };

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof systemState) => unknown) => sel(systemState),
}));

// The surface under test is the WIRING, so the Monitor itself is a counter.
// The factory body runs on first import, which is exactly the lazy-chunk
// request this file asserts does not happen before the first open.
vi.mock('@/features/fleet/monitor', async () => {
  h.moduleLoaded = true;
  const { useState } = await import('react');
  return {
    PersonaMonitor: ({ visible }: { visible?: boolean }) => {
      // A `useState` initializer runs once per MOUNT — which is the number
      // this file exists to pin. A render counter would not distinguish a
      // re-render from a rebuild.
      useState(() => {
        h.mounts += 1;
        return 0;
      });
      h.lastVisible = visible ?? null;
      return <div data-testid="monitor-stub" data-visible={String(visible)} />;
    },
  };
});

vi.mock('@/features/agents/quick-answer/QuickAnswerPopover', () => ({
  QuickAnswerPopover: () => null,
}));
vi.mock('@/features/schedules/components/SchedulesOverlay', () => ({ default: () => null }));
vi.mock('@/features/agents/sub_executions/components/CircuitBreakerIndicator', () => ({
  CircuitBreakerIndicator: () => null,
}));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { schedules: { title: 'Schedules' } }, tx: (s: string) => s }),
}));

import { TrayOverlays } from '../useTitleBarTray';

/** Re-render with a new overlay mode — the store mock is not reactive. */
function setOverlay(mode: string, rerender: (ui: React.ReactElement) => void) {
  systemState.headerOverlay = mode;
  act(() => rerender(<TrayOverlays />));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.mounts = 0;
  h.moduleLoaded = false;
  h.lastVisible = null;
  systemState.headerOverlay = 'none';
});

afterEach(cleanup);

describe('the Monitor is summoned once and then hidden', () => {
  it('does not request the chunk before the first open', () => {
    render(<TrayOverlays />);

    expect(h.moduleLoaded).toBe(false);
    expect(screen.queryByTestId('monitor-stub')).toBeNull();
  });

  it('mounts exactly once across open / close / reopen', async () => {
    const { rerender } = render(<TrayOverlays />);

    setOverlay('monitor', rerender);
    await screen.findByTestId('monitor-stub');
    expect(h.mounts).toBe(1);

    setOverlay('none', rerender);
    expect(screen.getByTestId('monitor-stub')).toBeTruthy();
    expect(h.mounts).toBe(1);

    setOverlay('monitor', rerender);
    expect(h.mounts).toBe(1);
  });

  it('stays mounted while closed, with visible=false', async () => {
    const { rerender } = render(<TrayOverlays />);

    setOverlay('monitor', rerender);
    await screen.findByTestId('monitor-stub');
    expect(h.lastVisible).toBe(true);

    setOverlay('none', rerender);
    expect(screen.getByTestId('monitor-stub').dataset.visible).toBe('false');

    setOverlay('monitor', rerender);
    expect(screen.getByTestId('monitor-stub').dataset.visible).toBe('true');
  });

  it('keeps it mounted while a SIBLING overlay is the open one', async () => {
    const { rerender } = render(<TrayOverlays />);

    setOverlay('monitor', rerender);
    await screen.findByTestId('monitor-stub');

    setOverlay('quick-answer', rerender);

    expect(screen.getByTestId('monitor-stub').dataset.visible).toBe('false');
    expect(h.mounts).toBe(1);
  });
});
