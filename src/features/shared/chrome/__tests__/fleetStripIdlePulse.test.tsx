/**
 * The strip's breathing pulse is an infinite framer tween. The strip is always
 * mounted (twice while the Monitor is open), so starting the tween with no bar
 * lit kept framer's frame loop busy for the whole idle session. It now runs
 * only while something is running, and stops when the last run ends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const { animateSpy, stopSpy, state } = vi.hoisted(() => ({
  animateSpy: vi.fn(),
  stopSpy: vi.fn(),
  state: {
    activeProcesses: {} as Record<string, unknown>,
    reapStaleRunning: () => {},
    maxParallelExecutions: 4,
    setMaxParallelExecutions: () => {},
  },
}));

vi.mock('framer-motion', async (importOriginal) => {
  const real = await importOriginal<typeof import('framer-motion')>();
  return {
    ...real,
    animate: (...args: unknown[]) => { animateSpy(...args); return { stop: stopSpy }; },
  };
});

const listeners = new Set<() => void>();
vi.mock('@/stores/overviewStore', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useOverviewStore: (selector: (s: typeof state) => unknown) =>
      useSyncExternalStore(
        (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
        () => selector(state),
      ),
  };
});
vi.mock('@/hooks/utility/interaction/useMotion', () => ({ useReducedMotion: () => false }));
vi.mock('@/hooks/utility/data/useSettings', () => ({ getAppSettingCoalesced: () => Promise.resolve(null) }));
vi.mock('@/hooks/utility/timing/usePolling', () => ({ usePolling: () => {} }));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { monitor: { strip_aria: 'strip' } }, tx: (s: string) => s }),
}));

import FleetActivityStrip from '../FleetActivityStrip';

function setProcesses(p: Record<string, unknown>) {
  state.activeProcesses = p;
  for (const l of listeners) l();
}

describe('FleetActivityStrip idle pulse', () => {
  beforeEach(() => { animateSpy.mockClear(); stopSpy.mockClear(); setProcesses({}); });

  it('starts no tween while nothing runs', () => {
    render(<FleetActivityStrip />);
    expect(animateSpy).not.toHaveBeenCalled();
  });

  // `animate` is fetched when a bar first lights (it is framer's animation
  // engine, kept off the startup path since 2026-10-25), so the tween starts a
  // tick after the run appears rather than in the same commit.
  it('starts the tween for a run and stops it when the run ends', async () => {
    render(<FleetActivityStrip />);
    const run = (startedAt: number) => ({ status: 'running', costUsd: 0, startedAt });
    act(() => setProcesses({ a: run(1) }));
    await waitFor(() => expect(animateSpy).toHaveBeenCalledTimes(1));
    // A second run joining does not restart the shared pulse.
    act(() => setProcesses({ a: run(1), b: run(2) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(animateSpy).toHaveBeenCalledTimes(1);
    act(() => setProcesses({ a: { status: 'queued', costUsd: 0, startedAt: 1 } }));
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
