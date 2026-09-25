import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DispatchDevice } from '@/lib/bindings/DispatchDevice';
import type { DevProject } from '@/lib/bindings/DevProject';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  const tx = (template: string, vars: Record<string, unknown> = {}) =>
    String(template).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  return { useTranslation: () => ({ t: en, tx }), getActiveTranslations: () => en, interpolate: tx };
});

vi.mock('@/lib/network/p2pCapability', () => ({ probeP2pSupport: vi.fn(() => Promise.resolve(true)) }));

const DESK: DispatchDevice = { peerId: 'peer-desk', displayName: 'Studio Desktop', isHome: false, reachability: 'connected' };
const dispatchRemoteFleetSession = vi.fn();
vi.mock('@/api/network/remoteSessions', () => ({
  listRemoteSessions: vi.fn(async () => []),
  listDispatchDevices: vi.fn(async () => [DESK]),
  dispatchRemoteFleetSession: (...a: unknown[]) => dispatchRemoteFleetSession(...a),
  remoteSessionCommand: vi.fn(),
  remoteSessionSubscribeOutput: vi.fn(),
}));

// Nothing may run locally when a device is picked.
const spawnSession = vi.fn();
const spawnHeadlessSession = vi.fn();
vi.mock('@/api/fleet/fleet', () => ({
  listSessions: vi.fn(async () => ({ sessions: [] })),
  renameSession: vi.fn(),
  spawnExternalConsole: vi.fn(),
  spawnHeadlessSession: (...a: unknown[]) => spawnHeadlessSession(...a),
  spawnSession: (...a: unknown[]) => spawnSession(...a),
}));
vi.mock('@/api/devTools/devTools', () => ({ createTask: vi.fn(), executeTask: vi.fn() }));

import { useSystemStore } from '@/stores/systemStore';
import { DispatchChooserModal, type DispatchRequest } from '../DispatchChooser';

const GIT = 'https://github.com/o/repo';
const PROJECT = { id: 'p1', name: 'repo', root_path: 'C:/src/repo', github_url: GIT, team_id: null } as DevProject;

const request = (over: Partial<DispatchRequest> = {}): DispatchRequest => ({
  title: 'Fix the flaky test',
  prompt: 'Make the login test deterministic.',
  target: { projectId: 'p1', projectName: 'repo', rootPath: 'C:/src/repo' },
  methods: ['dev_runner', 'fleet', 'cli', 'console'],
  ...over,
});

async function openOnDevice(req = request()) {
  const onDispatched = vi.fn();
  await act(async () => {
    render(<DispatchChooserModal request={req} onClose={vi.fn()} onDispatched={onDispatched} />);
  });
  fireEvent.click(await screen.findByTestId('run-on-trigger'));
  fireEvent.click(screen.getByTestId('run-on-option-peer-desk'));
  return onDispatched;
}

beforeEach(() => {
  dispatchRemoteFleetSession.mockReset();
  dispatchRemoteFleetSession.mockResolvedValue({ id: 'job-42', status: 'queued' });
  spawnSession.mockReset();
  spawnHeadlessSession.mockReset();
  useSystemStore.setState({
    projects: [PROJECT],
    dispatchDevices: [],
    p2pUnavailable: false,
    remoteSessionsPinned: false,
    applyRemoteJobUpdate: vi.fn(),
  } as never);
});

describe('DispatchChooser - run on another device', () => {
  it('disables the runner and the console once a device is picked', async () => {
    await openOnDevice();
    expect(screen.getByTestId('dispatch-method-dev_runner').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('dispatch-method-console').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('dispatch-method-dev_runner').textContent).toContain('Runs on this machine only');
    expect(screen.getByTestId('dispatch-method-fleet').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('dispatch-method-cli').hasAttribute('disabled')).toBe(false);
  });

  it('cli -> headless, with branch left for the backend to mint', async () => {
    const onDispatched = await openOnDevice();
    fireEvent.click(screen.getByTestId('dispatch-method-cli'));
    await act(async () => { fireEvent.click(screen.getByTestId('dispatch-confirm')); });
    await waitFor(() => expect(dispatchRemoteFleetSession).toHaveBeenCalledTimes(1));
    expect(dispatchRemoteFleetSession).toHaveBeenCalledWith('peer-desk', {
      projectId: 'p1',
      githubUrl: GIT,
      projectName: 'repo',
      prompt: 'Make the login test deterministic.',
      mode: 'headless',
      branch: '',
      personaId: null,
    });
    expect(onDispatched).toHaveBeenCalledWith('cli', 'job-42');
    expect(spawnHeadlessSession).not.toHaveBeenCalled();
  });

  it('fleet -> interactive', async () => {
    await openOnDevice();
    fireEvent.click(screen.getByTestId('dispatch-method-fleet'));
    await act(async () => { fireEvent.click(screen.getByTestId('dispatch-confirm')); });
    await waitFor(() => expect(dispatchRemoteFleetSession).toHaveBeenCalledTimes(1));
    expect(dispatchRemoteFleetSession.mock.calls[0]![1]).toMatchObject({ mode: 'interactive', branch: '' });
    expect(spawnSession).not.toHaveBeenCalled();
  });

  it('a dispatch that prepares files here keeps every device disabled', async () => {
    await act(async () => {
      render(<DispatchChooserModal request={request({ prepare: async () => undefined })} onClose={vi.fn()} />);
    });
    fireEvent.click(await screen.findByTestId('run-on-trigger'));
    expect(screen.getByTestId('run-on-option-peer-desk').getAttribute('aria-disabled')).toBe('true');
  });
});
