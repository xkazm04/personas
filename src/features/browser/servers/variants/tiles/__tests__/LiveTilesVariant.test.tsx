import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DevServerState } from '@/lib/bindings/DevServerState';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import LiveTilesVariant from '../../LiveTilesVariant';
import { isMenuKey, tileControl } from '../tileModel';

vi.mock('@/features/plugins/dev-tools/sub_workspaces/workspaceStore', () => ({
  useWorkspaces: () => ({
    workspaces: [
      { id: 'ws-core', name: 'Core', color: '#6366f1' },
      { id: 'ws-lab', name: 'Lab', color: '#10b981' },
    ],
  }),
}));

const NOW = Math.floor(Date.now() / 1000);

function server(
  projectId: string,
  devPort: number,
  state: DevServerState,
  extra: Partial<DevServerView> = {},
): DevServerView {
  return {
    projectId,
    projectName: projectId,
    rootPath: `C:\\dev\\${projectId}`,
    workspaceId: 'ws-core',
    techStack: 'Next.js,React,TypeScript',
    devCommand: 'npm run dev',
    devPort,
    state,
    pid: null,
    externalPid: null,
    startedAt: null,
    url: `http://localhost:${devPort}`,
    error: null,
    ...extra,
  };
}

// The ten harness servers (serverControlTapes.mjs), every state at least once.
const SERVERS: DevServerView[] = [
  server('desk-app', 1420, 'external', { externalPid: 29096, techStack: 'Vite,React,TypeScript,Tauri,Tailwind' }),
  server('marketing-site', 3000, 'running', { pid: 31092, startedAt: NOW - 134 * 60 }),
  server('ascent', 3001, 'starting', { pid: 30411, startedAt: NOW - 20 }),
  server('candidate', 3002, 'stopped'),
  server('case-portal', 3003, 'failed', { error: 'exited with code 1 before answering on port 3003' }),
  server('docs-site', 4321, 'running', { workspaceId: 'ws-lab', startedAt: NOW - 26 * 3600 }),
  server('api-gateway', 8080, 'stopping', { workspaceId: 'ws-lab' }),
  server('shop-admin', 5173, 'scanning', { workspaceId: 'ws-lab', techStack: null, devCommand: null }),
  server('tracklight', 3005, 'stopped', { workspaceId: 'ws-lab', techStack: 'Vue,Vite,TypeScript' }),
  server('ml-notebook', 8000, 'unconfigured', { workspaceId: null, techStack: 'Python', devCommand: null }),
];

function setup(hostPort: number | null = null) {
  const onMenu = vi.fn();
  const onToggle = vi.fn();
  const onAdd = vi.fn();
  render(
    <LiveTilesVariant servers={SERVERS} loading={false} hostPort={hostPort} onMenu={onMenu} onToggle={onToggle} onAdd={onAdd} />,
  );
  const item = (id: string) => screen.getAllByTestId('server-item').find((el) => el.dataset.projectId === id)!;
  return { onMenu, onToggle, item };
}

describe('LiveTilesVariant', () => {
  it('renders every server with its state attribute, grouped by workspace', () => {
    const { item } = setup();
    const items = screen.getAllByTestId('server-item');
    expect(items).toHaveLength(10);
    expect(item('case-portal').dataset.state).toBe('failed');
    expect(screen.getAllByTestId('server-tiles-group')).toHaveLength(3);
    expect(screen.getByText('Core')).toBeTruthy();
    expect(within(item('marketing-site')).getByText('3000')).toBeTruthy();
  });

  it('right-click anywhere on a tile calls onMenu with that server', () => {
    const { onMenu, item } = setup();
    fireEvent.contextMenu(within(item('docs-site')).getByText('npm run dev'));
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onMenu.mock.calls[0]![1].projectId).toBe('docs-site');
  });

  it('the Menu key and Shift+F10 open the same menu', () => {
    const { onMenu, item } = setup();
    fireEvent.keyDown(item('candidate'), { key: 'ContextMenu' });
    fireEvent.keyDown(item('candidate'), { key: 'F10', shiftKey: true });
    expect(onMenu).toHaveBeenCalledTimes(2);
    expect(onMenu.mock.calls[1]![1].projectId).toBe('candidate');
  });

  it('the power control toggles a running and a stopped server', () => {
    const { onToggle, item } = setup();
    fireEvent.click(within(item('marketing-site')).getByTestId('server-item-toggle'));
    fireEvent.click(within(item('candidate')).getByTestId('server-item-toggle'));
    expect(onToggle.mock.calls.map((c) => c[0].projectId)).toEqual(['marketing-site', 'candidate']);
  });

  it('shows the external pid, the failure and uptime', () => {
    const { item } = setup();
    expect(within(item('desk-app')).getByText('PID 29096')).toBeTruthy();
    expect(within(item('case-portal')).getByTestId('server-item-error').textContent).toContain('exited with code 1');
    expect(within(item('marketing-site')).getByText(/^Up /)).toBeTruthy();
  });

  it('host guard: the server Personas runs on is marked and its control is inert', () => {
    const { onToggle, item } = setup(1420);
    const host = item('desk-app');
    expect(within(host).getByTestId('server-item-host-guard')).toBeTruthy();
    const toggle = within(host).getByTestId('server-item-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('the scanning lamp carries the (motion-gated) pulse class', () => {
    const { item } = setup();
    expect(item('shop-admin').querySelector('.lt-lamp.is-pulse')).toBeTruthy();
  });

  it('loading renders the ghost, not items', () => {
    render(<LiveTilesVariant servers={[]} loading hostPort={null} onMenu={vi.fn()} onToggle={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByTestId('server-tiles-ghost')).toBeTruthy();
    expect(screen.queryAllByTestId('server-item')).toHaveLength(0);
  });
});

describe('tileModel', () => {
  it('tileControl decides the primary control', () => {
    expect(tileControl({ state: 'running', devPort: 3000 }, null)).toBe('stop');
    expect(tileControl({ state: 'external', devPort: 1420 }, null)).toBe('stop');
    expect(tileControl({ state: 'failed', devPort: 3003 }, null)).toBe('start');
    expect(tileControl({ state: 'unconfigured', devPort: 8000 }, null)).toBe('unconfigured');
    expect(tileControl({ state: 'scanning', devPort: 5173 }, null)).toBe('busy');
    expect(tileControl({ state: 'running', devPort: 1420 }, 1420)).toBe('host');
  });

  it('isMenuKey', () => {
    expect(isMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true);
    expect(isMenuKey({ key: 'F10', shiftKey: true })).toBe(true);
    expect(isMenuKey({ key: 'F10', shiftKey: false })).toBe(false);
  });
});
