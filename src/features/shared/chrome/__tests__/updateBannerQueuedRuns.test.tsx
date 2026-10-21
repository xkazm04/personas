/**
 * Install-when-idle must count queued runs as work: a queued run starts the
 * moment the last running one ends, so an install fired at runningCount 0 would
 * restart the app straight over it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

const installUpdate = vi.fn();
vi.mock('@/hooks/utility/data/useAutoUpdater', () => ({
  useAutoUpdater: () => ({
    updateAvailable: true,
    updateInfo: { version: '9.9.9', body: '' },
    isInstalling: false,
    downloadProgress: null,
    error: null,
    installUpdate,
    dismissUpdate: vi.fn(),
  }),
}));

const overviewState = { activeProcesses: {} as Record<string, { status: string }> };
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: typeof overviewState) => unknown) => sel(overviewState),
}));

vi.mock('@/i18n/useTranslation', () => ({
  interpolate: (s: string, vars: Record<string, unknown>) =>
    s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? '')),
  useTranslation: () => ({
    t: {
      common: { dismiss: 'Dismiss', cancel: 'Cancel' },
      chrome: {
        update_available: 'Update {version}',
        install_and_restart: 'Install and restart',
        update_jobs_running_warning: '{count} runs will be lost',
        update_install_anyway: 'Install anyway',
        update_install_when_idle: 'Install when idle',
        update_install_when_idle_status: 'Waiting for {count}',
      },
    },
  }),
}));

import UpdateBanner from '../UpdateBanner';

beforeEach(() => {
  installUpdate.mockReset();
  overviewState.activeProcesses = {};
});
afterEach(cleanup);

describe('UpdateBanner counts queued runs', () => {
  it('warns instead of installing when only queued runs exist', () => {
    overviewState.activeProcesses = { a: { status: 'queued' } };
    render(<UpdateBanner />);
    fireEvent.click(screen.getByText('Install and restart'));
    expect(installUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('1 runs will be lost')).toBeTruthy();
  });

  it('does not fire a deferred install while a queued run is still waiting', () => {
    overviewState.activeProcesses = { a: { status: 'running' }, b: { status: 'queued' } };
    const { rerender } = render(<UpdateBanner />);
    fireEvent.click(screen.getByText('Install and restart'));
    expect(screen.getByText('2 runs will be lost')).toBeTruthy();
    fireEvent.click(screen.getByText('Install when idle'));
    // The running one ends; the queued one is about to start.
    act(() => {
      overviewState.activeProcesses = { b: { status: 'queued' } };
      rerender(<UpdateBanner />);
    });
    expect(installUpdate).not.toHaveBeenCalled();
    // Everything has drained.
    act(() => {
      overviewState.activeProcesses = {};
      rerender(<UpdateBanner />);
    });
    expect(installUpdate).toHaveBeenCalledTimes(1);
  });
});
