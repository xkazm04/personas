/**
 * The Port map's wiring to the page: right-click and the Menu key reach
 * `onMenu`, the pin's primary control reaches `onToggle`, and the host guard,
 * the failed error, the external PID and the scanning pulse are all on screen.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { DevServerView } from '@/lib/bindings/DevServerView';

import PortMapVariant from '../PortMapVariant';

vi.mock('@/features/plugins/dev-tools/sub_workspaces/workspaceStore', () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: 'ws-core', name: 'Core', color: '#6366f1', projectIds: [], adoptDefaultSkills: false }],
    activeId: null,
  }),
}));

const NOW = Math.floor(Date.now() / 1000);

function server(projectId: string, devPort: number, state: DevServerView['state'], extra: Partial<DevServerView> = {}): DevServerView {
  return {
    projectId, projectName: projectId, rootPath: `C:\\dev\\${projectId}`, workspaceId: 'ws-core',
    techStack: 'Next.js,React,TypeScript', devCommand: 'npm run dev', devPort, state, pid: null,
    externalPid: null, startedAt: null, url: `http://localhost:${devPort}`, error: null, ...extra,
  };
}

const SERVERS: DevServerView[] = [
  server('desk-app', 1420, 'external', { externalPid: 29096 }),
  server('marketing-site', 3000, 'running', { pid: 31092, startedAt: NOW - 134 * 60 }),
  server('candidate', 3002, 'stopped'),
  server('case-portal', 3003, 'failed', { error: 'exited with code 1 before answering on port 3003' }),
  server('shop-admin', 5173, 'scanning', { devCommand: null, techStack: null }),
];

function renderMap(hostPort: number | null = null) {
  const onMenu = vi.fn((e: { preventDefault: () => void }, _server: DevServerView) => e.preventDefault());
  const onToggle = vi.fn();
  const onAdd = vi.fn();
  render(
    <PortMapVariant servers={SERVERS} loading={false} hostPort={hostPort} onMenu={onMenu} onToggle={onToggle} onAdd={onAdd} />,
  );
  const item = (id: string) => screen.getAllByTestId('server-item').find((el) => el.dataset.projectId === id)!;
  return { onMenu, onToggle, item };
}

describe('PortMapVariant', () => {
  it('renders every server as a server-item carrying its project id and state', () => {
    const { item } = renderMap();
    expect(screen.getAllByTestId('server-item')).toHaveLength(SERVERS.length);
    expect(item('marketing-site').dataset.state).toBe('running');
    expect(item('desk-app').dataset.state).toBe('external');
  });

  it('opens the menu on right-click and on the Menu key / Shift+F10', () => {
    const { onMenu, item } = renderMap();
    fireEvent.contextMenu(item('candidate'));
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onMenu.mock.calls[0]![1]).toMatchObject({ projectId: 'candidate' });

    fireEvent.keyDown(item('case-portal'), { key: 'ContextMenu' });
    fireEvent.keyDown(item('case-portal'), { key: 'F10', shiftKey: true });
    expect(onMenu).toHaveBeenCalledTimes(3);
    expect(onMenu.mock.calls[2]![1]).toMatchObject({ projectId: 'case-portal' });
  });

  it('calls onToggle from the primary control', () => {
    const { onToggle, item } = renderMap();
    fireEvent.click(within(item('marketing-site')).getByTestId('server-toggle'));
    fireEvent.click(within(item('candidate')).getByTestId('server-toggle'));
    expect(onToggle.mock.calls.map((c) => c[0].projectId)).toEqual(['marketing-site', 'candidate']);
  });

  it('makes the server serving Personas inert and says why', () => {
    const { onToggle, item } = renderMap(1420);
    const toggle = within(item('desk-app')).getByTestId('server-toggle');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
    expect(within(item('desk-app')).getByText('This server is serving Personas itself')).toBeTruthy();
  });

  it('shows the failed error, the external PID and the scanning pulse', () => {
    const { item } = renderMap();
    expect(within(item('case-portal')).getAllByText(/exited with code 1/).length).toBeGreaterThan(0);
    expect(within(item('desk-app')).getAllByText('PID 29096').length).toBeGreaterThan(0);
    expect(item('shop-admin').querySelector('.pm-lamp.is-pulse')).not.toBeNull();
  });

  it('renders its own ghost while loading, never a server item', () => {
    render(<PortMapVariant servers={[]} loading hostPort={null} onMenu={vi.fn()} onToggle={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByTestId('portmap-ghost')).toBeTruthy();
    expect(screen.queryAllByTestId('server-item')).toHaveLength(0);
  });
});
