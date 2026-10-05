/**
 * The Rack's contract with ServerSection: a right-click anywhere on a unit
 * (and the keyboard's menu chords) reaches `onMenu` exactly once, the power
 * switch reaches `onToggle`, and the host guard, the failed error, the
 * external pid, the scanning pulse and the workspace rails are on screen.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { DevServerView } from '@/lib/bindings/DevServerView';

import RackVariant from '../../RackVariant';
import { isMenuKey } from '../useMenuKey';

vi.mock('../../../serverModel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../serverModel')>();
  return {
    ...real,
    useWorkspaceIndex: () =>
      new Map([
        ['ws-core', { name: 'Core', color: '#6366f1' }],
        ['ws-lab', { name: 'Lab', color: '#10b981' }],
      ]),
  };
});

const NOW = Math.floor(Date.now() / 1000);

function server(projectId: string, devPort: number, state: DevServerView['state'], extra: Partial<DevServerView> = {}): DevServerView {
  return {
    projectId,
    projectName: `${projectId}-app`,
    rootPath: `C:\\dev\\${projectId}`,
    workspaceId: 'ws-core',
    techStack: 'Next.js,React,Elixir',
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

const SERVERS: DevServerView[] = [
  server('desk', 1420, 'external', { externalPid: 29096 }),
  server('site', 3000, 'running', { pid: 1, startedAt: NOW - 3600 }),
  server('cand', 3002, 'stopped'),
  server('case', 3003, 'failed', { error: 'exited with code 1 before answering on port 3003' }),
  server('shop', 5173, 'scanning', { workspaceId: 'ws-lab', techStack: null, devCommand: null }),
  server('nb', 8000, 'unconfigured', { workspaceId: null, devCommand: null }),
];

function renderRack(hostPort: number | null = null) {
  const onMenu = vi.fn();
  const onToggle = vi.fn();
  const onAdd = vi.fn();
  render(<RackVariant servers={SERVERS} loading={false} hostPort={hostPort} onMenu={onMenu} onToggle={onToggle} onAdd={onAdd} />);
  const unit = (id: string) => screen.getAllByTestId('server-item').find((el) => el.dataset.projectId === id)!;
  return { onMenu, onToggle, unit };
}

describe('RackVariant', () => {
  it('renders one unit per server with the contract attributes, grouped under workspace rails', () => {
    const { unit } = renderRack();
    expect(screen.getAllByTestId('server-item')).toHaveLength(SERVERS.length);
    expect(unit('site').dataset.state).toBe('running');
    expect(within(unit('site')).getByText('site-app')).toBeTruthy();
    expect(within(unit('site')).getByText('3000')).toBeTruthy();
    const rails = screen.getAllByTestId('rack-rail').map((el) => el.textContent ?? '');
    expect(rails).toHaveLength(3);
    expect(rails[0]).toContain('Core');
    expect(rails[1]).toContain('Lab');
  });

  it('a right-click anywhere on the unit calls onMenu with that server', () => {
    const { onMenu, unit } = renderRack();
    fireEvent.contextMenu(within(unit('cand')).getByText('3002'));
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onMenu.mock.calls[0]![1]).toBe(SERVERS[2]);
  });

  it('the Menu key and Shift+F10 open the same menu, once each', () => {
    const { onMenu, unit } = renderRack();
    fireEvent.keyDown(unit('site'), { key: 'ContextMenu' });
    fireEvent.keyDown(unit('case'), { key: 'F10', shiftKey: true });
    fireEvent.keyDown(unit('case'), { key: 'F10' });
    expect(onMenu).toHaveBeenCalledTimes(2);
    expect(onMenu.mock.calls.map((c) => c[1].projectId)).toEqual(['site', 'case']);
    expect(isMenuKey({ key: 'Enter', shiftKey: false })).toBe(false);
  });

  it('the power switch calls onToggle and does not open the menu', () => {
    const { onMenu, onToggle, unit } = renderRack();
    const power = within(unit('site')).getByTestId('rack-power');
    expect(power.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(power);
    fireEvent.click(within(unit('cand')).getByTestId('rack-power'));
    expect(onToggle.mock.calls.map((c) => c[0].projectId)).toEqual(['site', 'cand']);
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('the host guard marks the unit and makes its switch inert', () => {
    const { onToggle, unit } = renderRack(1420);
    expect(within(unit('desk')).getByTestId('rack-host-badge')).toBeTruthy();
    const power = within(unit('desk')).getByTestId('rack-power') as HTMLButtonElement;
    expect(power.disabled).toBe(true);
    fireEvent.click(power);
    expect(onToggle).not.toHaveBeenCalled();
    expect(within(unit('site')).queryByTestId('rack-host-badge')).toBeNull();
  });

  it('shows the failed error, the external pid, uptime and the scanning pulse', () => {
    const { unit } = renderRack();
    expect(within(unit('case')).getByTestId('rack-error').textContent).toContain('exited with code 1');
    expect(within(unit('desk')).getByText(/29096/)).toBeTruthy();
    expect(within(unit('site')).getByText(/1h/)).toBeTruthy();
    expect(unit('shop').querySelector('.rk-lamp.is-scan')).not.toBeNull();
    expect((within(unit('shop')).getByTestId('rack-power') as HTMLButtonElement).disabled).toBe(true);
    expect((within(unit('nb')).getByTestId('rack-power') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders its own ghost while loading, never the units', () => {
    render(<RackVariant servers={[]} loading hostPort={null} onMenu={vi.fn()} onToggle={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByTestId('rack-ghost')).toBeTruthy();
    expect(screen.queryAllByTestId('server-item')).toHaveLength(0);
  });
});
