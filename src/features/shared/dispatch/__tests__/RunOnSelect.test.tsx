import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { DispatchDevice } from '@/lib/bindings/DispatchDevice';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  const tx = (template: string, vars: Record<string, unknown> = {}) =>
    String(template).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  return { useTranslation: () => ({ t: en, tx }), getActiveTranslations: () => en, interpolate: tx };
});

let p2p = true;
vi.mock('@/lib/network/p2pCapability', () => ({ probeP2pSupport: vi.fn(() => Promise.resolve(p2p)) }));

let devices: DispatchDevice[] = [];
vi.mock('@/api/network/remoteSessions', () => ({
  listRemoteSessions: vi.fn(async () => []),
  listDispatchDevices: vi.fn(async () => devices),
  dispatchRemoteFleetSession: vi.fn(),
  remoteSessionCommand: vi.fn(),
  remoteSessionSubscribeOutput: vi.fn(),
}));

import { useSystemStore } from '@/stores/systemStore';
import { resetRemoteSessionsSliceForTests } from '@/stores/slices/network/remoteSessionsSlice';
import { RunOnSelect } from '../RunOnSelect';

const DESK: DispatchDevice = { peerId: 'peer-desk', displayName: 'Studio Desktop', isHome: true, reachability: 'connected' };
const LAPTOP: DispatchDevice = { peerId: 'peer-lap', displayName: 'Travel Laptop', isHome: false, reachability: 'offline' };

async function mount(props: Partial<Parameters<typeof RunOnSelect>[0]> = {}) {
  const onChange = vi.fn();
  await act(async () => {
    render(<RunOnSelect value={null} onChange={onChange} githubUrl="https://github.com/o/r" {...props} />);
  });
  return onChange;
}

beforeEach(() => {
  p2p = true;
  devices = [DESK, LAPTOP];
  resetRemoteSessionsSliceForTests();
  useSystemStore.setState({ dispatchDevices: [], remoteSessions: {}, p2pUnavailable: false, remoteSessionsPinned: false, remoteSessionsSynced: false });
});

describe('RunOnSelect', () => {
  it('is hidden entirely when this build has no p2p', async () => {
    p2p = false;
    useSystemStore.setState({ dispatchDevices: [DESK] });
    await mount();
    expect(screen.queryByTestId('run-on-select')).toBeNull();
  });

  it('is hidden when no device is paired', async () => {
    devices = [];
    await mount();
    expect(screen.queryByTestId('run-on-select')).toBeNull();
  });

  it('offers this machine and every paired device; an offline one stays selectable', async () => {
    const onChange = await mount();
    fireEvent.click(screen.getByTestId('run-on-trigger'));
    expect(screen.getByTestId('run-on-option-local')).toBeTruthy();
    const offline = screen.getByTestId('run-on-option-peer-lap');
    expect(offline.hasAttribute('disabled')).toBe(false);
    expect(offline.textContent).toContain('Queued until it wakes');
    fireEvent.click(offline);
    expect(onChange).toHaveBeenCalledWith('peer-lap');
  });

  it('disables every remote device when the project has no git remote', async () => {
    const onChange = await mount({ githubUrl: null });
    fireEvent.click(screen.getByTestId('run-on-trigger'));
    for (const id of ['peer-desk', 'peer-lap']) {
      const option = screen.getByTestId(`run-on-option-${id}`);
      expect(option.getAttribute('aria-disabled')).toBe('true');
      expect(option.textContent).toContain('Needs a git remote to return work');
      fireEvent.click(option);
    }
    expect(onChange).not.toHaveBeenCalled();
    // This machine is always available.
    expect(screen.getByTestId('run-on-option-local').hasAttribute('disabled')).toBe(false);
  });

  it('a caller reason blocks remote devices even with a git remote', async () => {
    await mount({ remoteBlockedReason: 'prepares files here' });
    fireEvent.click(screen.getByTestId('run-on-trigger'));
    expect(screen.getByTestId('run-on-option-peer-desk').textContent).toContain('prepares files here');
  });
});
