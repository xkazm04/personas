/**
 * A project bay answers a right-click anywhere on its body, not only on the
 * nameplate, and its menu carries the dev server's run items exactly when the
 * project has a server configured. The server's state also lands on the bay
 * as `data-server-state`, which is what lights (and breathes) its top edge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevServerView } from '@/lib/bindings/DevServerView';
import { useSystemStore } from '@/stores/systemStore';
import type { BoardColumn } from '../../useBoardModel';

const listDevServers = vi.fn<() => Promise<DevServerView[]>>();
vi.mock('@/api/devServers', () => ({
  listDevServers: () => listDevServers(),
  listenDevServers: () => Promise.resolve(() => undefined),
  startDevServer: vi.fn(),
  stopDevServer: vi.fn(),
  restartDevServer: vi.fn(),
}));

import { Bay } from './Bay';

const project = (id: string, teamId: string): DevProject =>
  ({ id, name: id, root_path: `/work/${id}`, team_id: teamId, enabled: true } as unknown as DevProject);

const server = (projectId: string, state: DevServerView['state'], devPort: number): DevServerView => ({
  projectId, projectName: projectId, rootPath: `/work/${projectId}`, workspaceId: null, techStack: null,
  devCommand: 'npm run dev', devPort, state, pid: state === 'running' ? 4100 : null, externalPid: null,
  startedAt: state === 'running' ? 1_700_000_000 : null, url: `http://localhost:${devPort}`, error: null,
});

const column = (teamId: string): BoardColumn =>
  ({
    teamId, teamName: teamId, teamColor: '#06b6d4', workspaceId: null, cards: [], rows: [],
    contestId: null, contestProjectId: null, remoteDevice: null,
  } as unknown as BoardColumn);

function renderBay(teamId: string) {
  const view = render(
    <Bay column={column(teamId)} rows={<p data-testid="bay-body">body</p>} liveCount={0} scoped={false} onScope={() => undefined} />,
  );
  return { ...view, bay: screen.getByTestId('fleet-grid-column') };
}

// The dev-server store is a module singleton, so every test hands it the same list.
beforeEach(() => {
  useSystemStore.setState({
    projects: [project('dp-run', 't-run'), project('dp-stop', 't-stop'), project('dp-none', 't-none')],
  } as never);
  listDevServers.mockResolvedValue([server('dp-run', 'running', 3000), server('dp-stop', 'stopped', 4321)]);
});

afterEach(() => {
  useSystemStore.setState({ projects: [] } as never);
});

describe('Bay right-click menu', () => {
  it('opens on the bay body and offers Stop for a running server', async () => {
    const { bay } = renderBay('t-run');
    expect(await screen.findByTestId('fleet-grid-column-server')).toBeTruthy();
    expect(bay.getAttribute('data-server-state')).toBe('running');

    fireEvent.contextMenu(screen.getByTestId('bay-body'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByTestId('server-menu-stop')).toBeTruthy();
    expect(within(menu).queryByTestId('server-menu-start')).toBeNull();
    expect(within(menu).getByTestId('server-menu-open')).toBeTruthy();
  });

  it('offers Start for a configured, stopped server and draws no port chip', async () => {
    const { bay } = renderBay('t-stop');
    await act(async () => { await Promise.resolve(); });
    expect(bay.getAttribute('data-server-state')).toBe('stopped');
    expect(screen.queryByTestId('fleet-grid-column-server')).toBeNull();

    fireEvent.contextMenu(bay);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByTestId('server-menu-start')).toBeTruthy();
    expect(within(menu).queryByTestId('server-menu-stop')).toBeNull();
  });

  it('gives a project with no server configured only the project switch', async () => {
    const { bay } = renderBay('t-none');
    await act(async () => { await Promise.resolve(); });
    expect(bay.hasAttribute('data-server-state')).toBe(false);

    fireEvent.contextMenu(screen.getByTestId('bay-body'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByTestId('server-menu-start')).toBeNull();
    expect(within(menu).queryByTestId('server-menu-stop')).toBeNull();
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
  });

  it('steps aside for a line that opened its own menu', () => {
    renderBay('t-run');
    const body = screen.getByTestId('bay-body');
    body.addEventListener('contextmenu', (e) => e.preventDefault());
    fireEvent.contextMenu(body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
