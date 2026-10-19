import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * The capability approval card renders the SELECTED app's label over the
 * LOADED manifest's capabilities, and Approve sends `manifest.connector_id`.
 * Selecting app B while app A's manifest was on screen kept A's manifest until
 * B's fetch landed, so for that window the card asked to approve B while the
 * button granted A's capabilities to A.
 */

type Manifest = { connector_id: string; capabilities: string[]; allowed_binaries: string[] };
const pending = new Map<string, (m: Manifest) => void>();
const approveDesktopCapabilities = vi.fn(async () => {});

vi.mock('@/api/system/desktop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/system/desktop')>()),
  discoverDesktopApps: vi.fn(async () => [
    { connector_name: 'app_a', label: 'Alpha App', installed: true, running: false, binary_path: null },
    { connector_name: 'app_b', label: 'Beta App', installed: true, running: false, binary_path: null },
  ]),
  importClaudeMcpServers: vi.fn(async () => []),
  getDesktopConnectorManifest: vi.fn(
    (name: string) => new Promise<Manifest>((resolve) => { pending.set(name, resolve); }),
  ),
  approveDesktopCapabilities: (...a: unknown[]) => approveDesktopCapabilities(...(a as [])),
}));

import { DesktopDiscoveryPanel } from '../DesktopDiscoveryPanel';
import { en } from '@/i18n/en';

const manifestA: Manifest = { connector_id: 'conn-a', capabilities: ['file_read'], allowed_binaries: [] };
const approveLabel = () => en.vault.desktop_discovery.approve_connect;

describe('DesktopDiscoveryPanel: approval binds to the app it names', () => {
  beforeEach(() => {
    pending.clear();
    approveDesktopCapabilities.mockClear();
  });

  it('hides the approval card while a newly selected app has no manifest yet', async () => {
    render(<DesktopDiscoveryPanel onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Alpha App'));
    await act(async () => { pending.get('app_a')!(manifestA); });
    expect(await screen.findByText(approveLabel())).toBeTruthy();

    fireEvent.click(screen.getByText('Beta App'));
    await waitFor(() => expect(pending.has('app_b')).toBe(true));

    expect(screen.queryByText(approveLabel())).toBeNull();
    expect(approveDesktopCapabilities).not.toHaveBeenCalled();
  });
});
