/**
 * Unit tests for FleetSettingsPage.
 *
 * Covers the three banner states (not installed / installed / port
 * mismatch) and the install/uninstall round-trip behavior with the
 * fleet API mocked. We don't reach into Tauri — the API module is
 * mocked at the module boundary.
 *
 * The page reads no Zustand store; banner state is driven entirely by
 * checkHooks() / installHooks() / uninstallHooks() return values.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/fleet/fleet', () => ({
  checkHooks: vi.fn(),
  installHooks: vi.fn(),
  uninstallHooks: vi.fn(),
  // The page renders <FleetProcessScanner/>, which scans the OS process table
  // on mount. Resolve to an empty list so the mount-effect doesn't throw on a
  // missing mock member; the scanner's behaviour is covered by its own tests.
  detectProcesses: vi.fn().mockResolvedValue([]),
  killPid: vi.fn().mockResolvedValue(undefined),
  resumeOrphan: vi.fn().mockResolvedValue(undefined),
}));

import * as fleetApi from '@/api/fleet/fleet';
import FleetSettingsPage from '../FleetSettingsPage';

function status(o: Partial<FleetHookStatus> = {}): FleetHookStatus {
  return {
    installed: false,
    presentEvents: [],
    missingEvents: ['SessionStart', 'Notification', 'Stop'],
    installedPort: null,
    portMatches: false,
    ...o,
  };
}

describe('FleetSettingsPage', () => {
  beforeEach(() => {
    vi.mocked(fleetApi.checkHooks).mockReset();
    vi.mocked(fleetApi.installHooks).mockReset();
    vi.mocked(fleetApi.uninstallHooks).mockReset();
  });

  it('shows the "not installed" banner on mount when no hooks are present', async () => {
    vi.mocked(fleetApi.checkHooks).mockResolvedValueOnce(status({ installed: false }));
    render(<FleetSettingsPage />);
    await waitFor(() =>
      expect(screen.getByTestId('fleet-hooks-banner-missing')).toBeInTheDocument(),
    );
    expect(screen.getByText('Hooks not installed')).toBeInTheDocument();
    // Uninstall is disabled when nothing's installed — important so
    // the user can't no-op-click into a confusing toast.
    expect(screen.getByTestId('fleet-uninstall-hooks')).toBeDisabled();
  });

  it('shows the "installed" banner with the resolved port when hooks are present', async () => {
    vi.mocked(fleetApi.checkHooks).mockResolvedValueOnce(
      status({ installed: true, portMatches: true, installedPort: 17400, presentEvents: ['Stop', 'Notification'] }),
    );
    render(<FleetSettingsPage />);
    await waitFor(() =>
      expect(screen.getByTestId('fleet-hooks-banner-installed')).toBeInTheDocument(),
    );
    // Scope to the banner — FleetPairDevice also renders 127.0.0.1:<port>,
    // so an unscoped getByText(/17400/) matches two nodes.
    expect(
      within(screen.getByTestId('fleet-hooks-banner-installed')).getByText(/17400/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('fleet-install-hooks')).toHaveTextContent(/re-?install/i);
    expect(screen.getByTestId('fleet-uninstall-hooks')).not.toBeDisabled();
  });

  it('shows the port-mismatch banner when installed but port drifted', async () => {
    vi.mocked(fleetApi.checkHooks).mockResolvedValueOnce(
      status({ installed: true, portMatches: false, installedPort: 17999, presentEvents: ['Stop'] }),
    );
    render(<FleetSettingsPage />);
    await waitFor(() =>
      expect(screen.getByTestId('fleet-hooks-banner-mismatch')).toBeInTheDocument(),
    );
    expect(screen.getByText('Port mismatch')).toBeInTheDocument();
  });

  it('Install button calls installHooks and applies the returned status', async () => {
    vi.mocked(fleetApi.checkHooks).mockResolvedValueOnce(status({ installed: false }));
    vi.mocked(fleetApi.installHooks).mockResolvedValueOnce(
      status({ installed: true, portMatches: true, installedPort: 17400, presentEvents: ['Stop', 'Notification', 'SessionStart'], missingEvents: [] }),
    );

    render(<FleetSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('fleet-hooks-banner-missing')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId('fleet-install-hooks'));

    await waitFor(() => expect(screen.getByTestId('fleet-hooks-banner-installed')).toBeInTheDocument());
    expect(vi.mocked(fleetApi.installHooks)).toHaveBeenCalledTimes(1);
  });

  it('Uninstall button calls uninstallHooks and reverts the banner', async () => {
    vi.mocked(fleetApi.checkHooks).mockResolvedValueOnce(
      status({ installed: true, portMatches: true, installedPort: 17400, presentEvents: ['Stop', 'Notification'] }),
    );
    vi.mocked(fleetApi.uninstallHooks).mockResolvedValueOnce(status({ installed: false, presentEvents: [] }));

    render(<FleetSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('fleet-hooks-banner-installed')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId('fleet-uninstall-hooks'));

    await waitFor(() => expect(screen.getByTestId('fleet-hooks-banner-missing')).toBeInTheDocument());
    expect(vi.mocked(fleetApi.uninstallHooks)).toHaveBeenCalledTimes(1);
  });

  it('Refresh button re-runs checkHooks', async () => {
    vi.mocked(fleetApi.checkHooks)
      .mockResolvedValueOnce(status({ installed: false }))
      .mockResolvedValueOnce(status({ installed: true, portMatches: true, installedPort: 17400, presentEvents: ['Stop'] }));

    render(<FleetSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('fleet-hooks-banner-missing')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId('fleet-refresh-hooks'));

    await waitFor(() => expect(screen.getByTestId('fleet-hooks-banner-installed')).toBeInTheDocument());
    expect(vi.mocked(fleetApi.checkHooks)).toHaveBeenCalledTimes(2);
  });
});
