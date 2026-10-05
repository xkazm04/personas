/**
 * The Switchboard's contract with ServerSection: right-click (and the keyboard's
 * menu chords) reach `onMenu`, the switch and Space/Enter reach `onToggle`, and
 * the host guard, the failed error and the external pid are on screen.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { DevServerView } from '@/lib/bindings/DevServerView';

import SwitchboardVariant from '../../SwitchboardVariant';
import { isInert, stepIndex, summarize, switchPosition } from '../switchboardModel';

vi.mock('../../../serverModel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../serverModel')>();
  return {
    ...real,
    useWorkspaceIndex: () => new Map([['ws-core', { name: 'Core', color: '#6366f1' }]]),
  };
});

const NOW = Math.floor(Date.now() / 1000);

function server(projectId: string, devPort: number, state: DevServerView['state'], extra: Partial<DevServerView> = {}): DevServerView {
  return {
    projectId,
    projectName: projectId,
    rootPath: `C:\\dev\\${projectId}`,
    workspaceId: 'ws-core',
    techStack: 'Vite,React,Elixir',
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
  server('case', 3003, 'failed', { error: 'exited with code 1' }),
  server('shop', 5173, 'scanning', { devCommand: null, workspaceId: null }),
];

function setup(hostPort: number | null = null) {
  const onMenu = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  const onToggle = vi.fn();
  render(
    <SwitchboardVariant servers={SERVERS} loading={false} hostPort={hostPort} onMenu={onMenu} onToggle={onToggle} onAdd={vi.fn()} />,
  );
  const item = (id: string) => screen.getAllByTestId('server-item').find((el) => el.dataset.projectId === id)!;
  return { onMenu, onToggle, item };
}

describe('SwitchboardVariant', () => {
  it('renders one item per server with its id and state', () => {
    const { item } = setup();
    expect(screen.getAllByTestId('server-item')).toHaveLength(5);
    expect(item('case').dataset.state).toBe('failed');
    expect(within(item('site')).getByText('3000')).toBeTruthy();
  });

  it('right-click on an item calls onMenu with that server', () => {
    const { onMenu, item } = setup();
    fireEvent.contextMenu(item('cand'));
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onMenu.mock.calls[0]![1]).toMatchObject({ projectId: 'cand' });
  });

  it('the Menu key and Shift+F10 open the same menu', () => {
    const { onMenu, item } = setup();
    fireEvent.keyDown(item('site'), { key: 'ContextMenu' });
    fireEvent.keyDown(item('cand'), { key: 'F10', shiftKey: true });
    expect(onMenu.mock.calls.map((c) => (c[1] as DevServerView).projectId)).toEqual(['site', 'cand']);
  });

  it('the switch and Space/Enter call onToggle', () => {
    const { onToggle, item } = setup();
    fireEvent.click(within(item('cand')).getByRole('switch'));
    fireEvent.keyDown(item('site'), { key: ' ' });
    fireEvent.keyDown(item('desk'), { key: 'Enter' });
    expect(onToggle.mock.calls.map((c) => (c[0] as DevServerView).projectId)).toEqual(['cand', 'site', 'desk']);
  });

  it('arrow keys move the roving focus between rows', () => {
    const { item } = setup();
    item('desk').focus();
    fireEvent.keyDown(item('desk'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('site'));
    expect(item('site').tabIndex).toBe(0);
    expect(item('desk').tabIndex).toBe(-1);
  });

  it('the host server shows its badge and its switch is inert', () => {
    const { onToggle, item } = setup(3000);
    const row = item('site');
    expect(within(row).getByText('Serves Personas')).toBeTruthy();
    expect((within(row).getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(row, { key: ' ' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('shows the failed error, the external pid and the scanning pulse', () => {
    const { item } = setup();
    expect(within(item('case')).getByTestId('server-error').textContent).toBe('exited with code 1');
    expect(within(item('desk')).getByText('PID 29096')).toBeTruthy();
    expect(item('shop').querySelector('.sb-lamp.is-pulse')).not.toBeNull();
    // An unresolved tech token stands in as text.
    expect(within(item('site')).getByText('Elixir')).toBeTruthy();
  });

  it('renders a ghost, not rows, while loading', () => {
    render(<SwitchboardVariant servers={[]} loading hostPort={null} onMenu={vi.fn()} onToggle={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByTestId('switchboard-loading')).toBeTruthy();
    expect(screen.queryAllByTestId('server-item')).toHaveLength(0);
  });
});

describe('switchboardModel', () => {
  it('summarizes counts and port holders', () => {
    const s = summarize([...SERVERS, server('gw', 8080, 'stopping')]);
    expect([s.running, s.external, s.failed]).toEqual([1, 1, 1]);
    expect(s.portHolders.map((x) => x.devPort)).toEqual([1420, 3000, 8080]);
  });

  it('places the switch and decides inertness', () => {
    expect(switchPosition('external')).toBe('on');
    expect(switchPosition('stopping')).toBe('mid');
    expect(switchPosition('failed')).toBe('off');
    expect(isInert({ state: 'scanning', devPort: 1 }, null)).toBe(true);
    expect(isInert({ state: 'running', devPort: 1420 }, 1420)).toBe(true);
    expect(isInert({ state: 'stopped', devPort: 3002 }, 1420)).toBe(false);
  });

  it('steps without wrapping', () => {
    expect(stepIndex('ArrowDown', 4, 5)).toBe(4);
    expect(stepIndex('ArrowUp', 0, 5)).toBe(0);
    expect(stepIndex('End', 0, 5)).toBe(4);
    expect(stepIndex('x', 0, 5)).toBeNull();
  });
});
